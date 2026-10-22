# INV-06 — API contract, auth/session, realtime, deployment topology

Source: `D:\temp-repo\old-repo` (legacy CRA frontend + Express/Mongo backend). Backend is to remain UNCHANGED; this is the contract a Vite + Tailwind rebuild must honour.

Conventions used below
- **auth column**: `public` = no middleware; `maybe` = `maybeAuthenticated` (sets `req.user` if a valid `authToken` cookie exists, never rejects); `cookie` = `isAuthenticated` (cookie JWT + DB tokenVersion check); `admin` = `isAuthenticated + isAdmin`; `subadmin` = `isAuthenticated + isSubAdmin` (loads `req.subAdmin`, refuses `disabled` / `awaiting_activation`); `subadmin-W` = subadmin + `requireSubAdminWritable` + `subAdminWriteLimiter`; `self|admin` = `isSelfOrAdmin`; `self|admin|owner` = `isSelfAdminOrOwner` (admin, the user, or the sub-admin whose `managedBy` matches); `admin|owner` = `isAdminOrOwner`; `subscribed` = `isSubscribed`; `subOrZoom` = `isSubscribedOrLimitedZoom` (expired/pending users get through only when `z<=16`, Suspended always 403; both enforce tehsil/mouza access via `hasAccess`).
- **limiter**: `strict` = 20/15 min keyed `ip_userId` (skips successful, skips admin); `register` = 5/h; `pwreset` = 3/h; `geo` = 60/min; `api` = 100/15 min; `saWrite` = 150/15 min per sub-admin. All skip `userType==='admin'` except `saWrite`. Store = Redis (`rl:*` prefixes) with in-memory fallback.
- **CSRF**: every non-GET/HEAD/OPTIONS request must carry `x-csrf-token` header unless the path starts with one of the exempt prefixes (see §2). "exempt" column = `Y` when the path matches an exempt prefix.
- All routes are mounted at the app root (no `/api` router prefix) except `configRoutes` (mounted at `/api/config`). Many auth routes exist twice (`/login` and `/api/login`); the frontend only uses the `/api/*` variants unless noted.
- Frontend file paths are relative to `src/`. `C/` = `components/`. Files marked **(dead)** are not imported anywhere (see §9).

---

## 1. Endpoint table

### 1a. `backend/routes/authRoutes.js`

| Method | Path | Auth | Limiter | CSRF exempt | Used by | Request | Response |
|---|---|---|---|---|---|---|---|
| POST | `/api/login` (also `/login`) | maybe + `loginValidation` | `strict` only applied on failed attempt (called inline) | Y | `context/AuthContext.js` `login()` | `{ userId, password, otp?, deviceId, deviceSignature, deviceLabel }` (device fields from `utils/deviceUtils.getDevicePayload()`) | `200 { message:'Login successful' }` + `Set-Cookie authToken` (+ `did`); or `200 { needsOTP:true, message }` (first login, OTP emailed); `401 {message}`; `403` PendingVerification / AwaitingActivation; `429` OTP cap |
| GET | `/api/login`, `/login` | public | — | n/a | nobody | — | `{status:'ok', message}` |
| POST | `/api/register` (also `/register`) | maybe + `registrationLimiter` + `registerValidation` | `register` | Y | `C/Auth/PublicUserRegistration.js` | `{ userId, password, userName, email, mobileNumber, subscriptionType, tehsilAccess:[{tehsil,mouzas}], deviceId, captchaToken }` (public reg = exactly 1 tehsil / 1 mouza; Turnstile when `ENABLE_TURNSTILE`) | `201 {message}`; `400 {error}`; `403 {code:'AKAR_RESTRICTED', error}` |
| GET | `/api/verify-email?token=` (also `/verify-email`) | maybe | — | n/a (GET) | `C/Auth/VerifyEmail.js` (tries `/api/verify-email` then `/verify-email`) | query `token` | `200 { message, userId?, ... }`; `400 {error}` |
| ALL | `/api/logout` (also `/logout`) | maybe | — | Y | `AuthContext.logout/switchAccount/clearAppData`, `C/Auth/ResetPassword.js` | `{ clearAll?: true }` | `{message:'Logout successful'}`; if `adminAuthToken` present and not clearAll → restores admin cookie and returns `{message, adminRestored:true}`; GET → 302 to `FRONTEND_URL` or `https://dashboard.naqsha-zameen.pk/login` |
| POST | `/api/change-password` (also `/change-password`) | cookie + `changePasswordValidation` | `strict` | N | `AuthContext.changePassword` | `{ userId, oldPassword, newPassword }` | `{message}`; clears `authToken`; 24 h cooldown → 429 |
| POST | `/api/forgot-password` (also `/forgot-password`) | maybe | `pwreset` | Y | `C/Auth/Login.js`, `App/Modals/ForgotPasswordModal.js` (uses `/forgot-password`) | `{ userId }` | `200 {message}` (email with `${FRONTEND}/reset-password?token=`) ; 24 h cooldown → 429 |
| POST | `/api/reset-password` (also `/reset-password`) | maybe + `resetPasswordValidation` | `pwreset` | Y | `C/Auth/ResetPassword.js` | `{ token, password }` | `{message}`; bumps `tokenVersion`, clears all cookies |
| POST | `/api/admin/login-as/:userId(*)` (also `/admin/login-as/…`) | cookie + `admin\|owner` | `strict` | Y | `AuthContext.loginAs` | — | `{message:'Impersonation successful'}`; sets `authToken`=target, `adminAuthToken`=caller's token; Session marked `adminImpersonated` |
| GET | `/admin/login-as/…`, `/api/admin/login-as/…` | public | — | n/a | nobody | — | `405` |
| GET | `/demo-access/:token` | maybe | `api` | n/a | browser redirect from `C/Admin/DemoAccess.js` (route `/demo/:token`) | path token | sets short-lived `authToken` (claims `{userId}` only, exp = link remaining) and 302 → `${FRONTEND_URL\|CORS_ORIGIN\|dashboard}/`; HTML error pages on bad token |

### 1b. `backend/routes/userRoutes.js`

| Method | Path | Auth | Limiter | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|---|
| GET | `/api/profile` (also `/profile`) | cookie | — | n/a | `AuthContext.fetchUserProfile` | — | sanitized User (see §2.7) |
| POST | `/api/users/:userId(*)/active-tehsil` | cookie + self\|admin | — | N | `AuthContext.setActiveTehsil` | `{ tehsil }` | `{ message, user: sanitizedUser }` |
| POST | `/api/users/:userId(*)/renew` | admin | — | N | — (only `/api/subadmin/users/:id/renew` is used by UI) | `{ subscriptionType }` | `{message, user}` or `{message, duplicate:true}` |
| POST | `/api/users/:userId(*)/email` | cookie + self\|admin + `emailUpdateValidation` | — | N | `App/Modals/EmailSetupModal.js` (uses `/users/:id/email` — NOTE no `/api` prefix; that path does **not** exist → 404/HTML; modal is disabled via `needsEmail=false`) | `{ email }` | `{message, email}` |
| GET | `/api/users?page&limit&tab&searchName&searchId&searchTehsil&searchPhone&searchEmail&sortKey&sortDir` | admin + `paginationValidation` | — | n/a | `C/User/UserList.js`, `C/Admin/AdminSubAdminConsole.js` | query | `{ users:[enriched], subAdmins:[{userId,userName}], statistics, pagination:{page,limit,total,pages} }` |
| GET | `/api/users/search?query=` | admin + `searchValidation` | — | n/a | not referenced in src | query | `[users]` |
| POST | `/api/admin/users/register` | admin + `registerValidation` | — | N | `C/Auth/UserRegistration.js` | same fields as register + `userType`, `tehsilAccess` required, `fee`, etc. | `201 {message}` |
| POST | `/api/users/:userId(*)/reset-default-password` | cookie + admin\|owner | — | N | `C/Common/PasswordResetModal.js`, `C/User/UserManagement/BulkOperations.js` (dead) | — | `{ message, userId, userName, temporaryPassword, emailSent }` |
| POST | `/api/users/:userId(*)/demo-links` | cookie + admin\|owner | — | N | `C/User/UserEditForm.js`, `UserList.js`, `UserActions.js`(dead) | `{ expiresInMinutes=60 }` | `201 { token, expiresAt, url }` (url = `${API_ORIGIN}/demo-access/<token>`, override `DEMO_LINK_BASE_URL`) |
| POST | `/api/user-warning/:userId(*)` | admin | — | N | not referenced in src | `{ warningType, message }` | `{ message, warningCount }` |
| POST | `/api/users/:userId(*)/devices/:deviceId/forget` | admin | — | N | `C/User/UserEditSections/MultiUseSection.js` | — | `{message}` |
| GET | `/api/public/check-userid/:userId(*)` | maybe | `api` | n/a | `C/Auth/PublicUserRegistration.js` | — | `{ exists:boolean }` |
| POST | `/api/users/:userId(*)/renewal-token` | cookie | `api` | N | `App/Modals/SubscriptionWarningModal.js`, `C/Common/SubscriptionWarningBanner.js` | `{ requestType? }` | `{ token, deepLink:'<frontendOrigin>/admin/activate/<token>', requestType, expiresAt, payFirst, message }`; also creates a Notification for the provider with `action.url=/admin/activate/<token>` |
| GET | `/api/admin/resolve-token/:token` | cookie (admin any; sub-admin only own customers) | — | n/a | `C/Admin/AdminActivate.js` | — | `{ userId, userName, requestType, requestId, requestedAt, customer: snapshot }` |
| GET | `/api/users/:userId(*)/login-history` | cookie + self\|admin | — | n/a | `C/User/UserDetail.js`, `UserDetailTabs/{LoginHistoryTab,HeatmapTab,LocationMapTab}.js` | — | `[ sessions ]` |
| GET | `/api/users/:userId(*)/history?page&limit` | admin | — | n/a | `C/User/UserDetailTabs/HistoryTab.js` | — | `{ events, pagination }` |
| GET | `/api/users/:userId(*)` | cookie + self\|admin\|owner | — | n/a | `C/User/UserDetail.js`, `UserEditForm.js`, `EditProfileForm.js`(dead) | — | sanitized user |
| PUT | `/api/users/:userId(*)` | cookie + self\|admin\|owner + `updateUserValidation` | — | N | `C/User/UserList.js`, `UserEditForm.js` | partial user `{ userName, email, mobileNumber, password?, subscriptionType, startDate, tehsilAccess:[{tehsil,mouzas}], activeTehsil, status, fee, … }` (sub-admins restricted to a field whitelist) | `{ message, duplicate, user }` |
| DELETE | `/api/users/:userId(*)` | admin | — | N | `UserList.js`, `UserEditForm.js`, `BulkOperations.js`(dead), `UserActions.js`(dead) | — | `{message}` |
| POST | `/api/admin/scan-hosting` | admin | — | N | `App/NavigationMenu.js` | — | `{ … scan summary }` |

### 1c. `backend/routes/subAdminRoutes.js` (mounted before userRoutes)

| Method | Path | Auth | Limiter | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|---|
| GET | `/api/activation-info?token=` | public | `api` | n/a | `C/Admin/ActivationPages.js` (route `/activate/:token`) | query token | `{ userId, userName, plan, mouzas:[], customerFee, providerName, … }` or `{alreadyActive:true,userId}` |
| POST | `/api/activate` | public | `strict` | N (needs CSRF) | ActivationPages | `{ token, deviceId }` | `{ message, userId }`; 410 expired; 409 trial device reuse |
| GET | `/api/subadmin/activation-info?token=` | public | `api` | n/a | ActivationPages (route `/subadmin/activate/:token`) | query | `{ userId, userName, territory, policy, … }` |
| POST | `/api/subadmin/activate` | public | `strict` | N | ActivationPages | `{ token, acceptPolicyVersion }` | `{message, userId}` |
| POST | `/api/confirm-email-change` | public | `strict` | N | ActivationPages (route `/confirm-email/:token`) | `{ token }` | `{message}` |
| GET | `/api/users/me/provider` | cookie | — | n/a | not referenced (profile already carries `provider`) | — | provider `{ name, jazzcash, easypaisa, phone, whatsapp, bank?, isSubAdmin? }` |
| POST | `/api/users/me/report-provider` | cookie | `api` | N | `C/User/EditProfileForm.js` (dead) | `{ message }` (≥10 chars) | `{message}` |
| GET | `/api/subadmin/me` | subadmin | — | n/a | `C/Admin/SubAdminDashboard.js`, `SubAdminUsers.js` | — | `{ profile:{userId,userName,email,mobileNumber}, subAdmin:{status,territory,allowedPlans,trialQuotaPerMonth,trialMaxMouzas,maxMouzas,finalWarning,paymentDetails,unpaidThreshold,paymentWindowDays}, money:{todayTotal,todayLines,balance,overdue,advanceCredit,oldestUnpaid}, prices… }` |
| PUT | `/api/subadmin/me/payment-details` | subadmin | `saWrite` | N | SubAdminDashboard | `{ jazzcash:{title,number}, easypaisa:{…}, phone, whatsapp, bank:{name,title,iban} }` | `{message}` |
| GET | `/api/subadmin/pricing/quote?mouzas&plan` | subadmin | — | n/a | SubAdminUsers / modal | query | `{ ok, plan, price, tier… }` |
| GET | `/api/subadmin/users` | subadmin | — | n/a | SubAdminUsers | query filters | `{ users:[…] }` |
| POST | `/api/subadmin/users` | subadmin-W | `saWrite` | N | SubAdminUsers (`SubAdminModal`) | `{ userId, userName, mobileNumber, email, password, plan, assignment:[{tehsil,mouzas}], activeTehsil, customerFee, requestKey }` | `201 {message, user}` |
| GET | `/api/subadmin/users/:userId(*)/history` | subadmin | — | n/a | SubAdminUsers | — | `{events}` |
| POST | `/api/subadmin/users/:userId(*)/resend-activation` | subadmin-W | `saWrite` | N | SubAdminUsers | — | `{message}` |
| PATCH | `/api/subadmin/users/:userId(*)/profile` | subadmin-W | `saWrite` | N | SubAdminUsers | `{ userName?, mobileNumber?, email?, resetPassword?:true }` | `{message, …}` |
| PUT | `/api/subadmin/users/:userId(*)/assignment` | subadmin-W | `saWrite` | N | SubAdminUsers | `{ assignment:[{tehsil,mouzas}], activeTehsil?, requestKey? }` | `{message, user}` |
| POST | `/api/subadmin/users/:userId(*)/renew` | subadmin-W | `saWrite` | N | SubAdminUsers | `{ plan, customerFee, requestKey }` | `{message, user}` |
| POST | `/api/subadmin/users/:userId(*)/suspend` | subadmin-W | `saWrite` | N | SubAdminUsers | `{ reason? }` | `{message}` |
| POST | `/api/subadmin/users/:userId(*)/reactivate` | subadmin-W | `saWrite` | N | SubAdminUsers | — | `{message}` |
| GET | `/api/subadmin/users/:userId(*)` | subadmin | — | n/a | SubAdminUsers | — | user |
| POST | `/api/subadmin/requests` | subadmin-W | `saWrite` | N | SubAdminDashboard/Users | `{ kind, reason, userId, eventId?, assignment? }` | `{message, request}` |
| GET | `/api/subadmin/requests` | subadmin | — | n/a | SubAdminDashboard | — | `{requests}` |
| GET | `/api/subadmin/today` | subadmin | — | n/a | SubAdminDashboard | — | today's lines |
| GET | `/api/subadmin/bills` | subadmin | — | n/a | SubAdminDashboard | — | `{bills}` |
| GET | `/api/subadmin/bills/:id` | subadmin | — | n/a | SubAdminDashboard | — | bill with lines |
| GET | `/api/subadmin/payments` | subadmin | — | n/a | SubAdminDashboard | — | `{payments}` |
| GET | `/api/subadmin/stats` | subadmin | — | n/a | SubAdminDashboard | — | chart series |
| GET | `/api/admin/subadmins` | admin | — | n/a | `C/Admin/AdminSubAdminConsole.js` | — | `{ subAdmins:[…] }` |
| POST | `/api/admin/subadmins` | admin | — | N | AdminSubAdminConsole | `{ userId, userName, email, mobileNumber, password, territory:[tehsil] }` | `201` |
| GET | `/api/admin/subadmins-overview` | admin | — | n/a | AdminSubAdminConsole | — | overview |
| GET | `/api/admin/subadmins-rankings` | admin | — | n/a | AdminSubAdminConsole | — | rankings |
| POST | `/api/admin/subadmins/promote/:userId(*)` | admin | — | N | AdminSubAdminConsole | `{ territory }` | `{message}` |
| GET | `/api/admin/subadmins/:userId/events` | admin | — | n/a | AdminSubAdminConsole | — | `{events}` |
| GET | `/api/admin/subadmins/:userId/stats` | admin | — | n/a | AdminSubAdminConsole | — | same as subadmin stats |
| GET | `/api/admin/subadmins/:userId/bills` | admin | — | n/a | AdminSubAdminConsole | — | `{bills}` |
| POST | `/api/admin/subadmins/:userId/payments` | admin | — | N | AdminSubAdminConsole | `{ amount, method, reference?, receivedAt?, confirmDuplicate? }` | `{message, payment}` |
| POST | `/api/admin/subadmins/:userId/correct-balance` | admin | — | N | AdminSubAdminConsole | `{ amount, reason }` | `{message}` |
| PUT | `/api/admin/subadmins/:userId/payment-details` | admin | — | N | AdminSubAdminConsole | `{ locked?, …details }` | `{message}` |
| POST | `/api/admin/subadmins/:userId/disable` / `enable` / `restore` / `resend-activation` | admin | — | N | AdminSubAdminConsole | `{ reason? }` | `{message}` |
| GET | `/api/admin/subadmins/:userId` | admin | — | n/a | AdminSubAdminConsole | — | detail |
| PATCH | `/api/admin/subadmins/:userId` | admin | — | N | AdminSubAdminConsole | `{ territory?, allowedPlans?, trialQuotaPerMonth?, … }` | `{message}` |
| GET | `/api/admin/subadmin-bills/:billId` | admin | — | n/a | AdminSubAdminConsole | — | bill lines |
| POST | `/api/admin/subadmin-payments/:paymentId/reverse` | admin | — | N | AdminSubAdminConsole | `{ reason }` | `{message}` |
| PUT | `/api/admin/subadmin-payments/:paymentId` | admin | — | N | AdminSubAdminConsole | `{ amount, method, reason, receivedAt }` | `{message}` |
| PUT | `/api/admin/subadmins/:userId/bill-lines/:eventId` | admin | — | N | AdminSubAdminConsole | `{ amount, reason }` | `{message}` |
| POST | `/api/admin/users/assign` | admin | — | N | `C/User/UserList.js` | `{ userIds:[], subAdminId\|null }` | `{message, moved}` |
| GET | `/api/admin/subadmin-requests` | admin | — | n/a | AdminSubAdminConsole | — | `{requests}` |
| POST | `/api/admin/subadmin-requests/:id/approve` | admin | — | N | AdminSubAdminConsole | `{ monthlyPrice?, yearlyPrice? }` | `{message}` |
| POST | `/api/admin/subadmin-requests/:id/reject` | admin | — | N | AdminSubAdminConsole | `{ reason? }` | `{message}` |
| GET / PUT | `/api/admin/pricing` | admin | — | PUT N | AdminSubAdminConsole | PUT `{ tiers, maxMouzas, trialMaxMouzas, yearlyDiscountPct, minUpgradeCharge, roundMode, roundTo, note }` | pricing doc |
| GET | `/api/admin/pricing/versions` | admin | — | n/a | AdminSubAdminConsole | — | `[versions]` |
| POST | `/api/admin/pricing/versions/:version/restore` | admin | — | N | AdminSubAdminConsole | — | `{message}` |
| GET / PUT | `/api/admin/payment-details` | admin | — | PUT N | AdminSubAdminConsole | details object | details |
| GET / PUT | `/api/admin/subadmin-policy` | admin | — | PUT N | AdminSubAdminConsole | `{ text:[lines] }` | `{ version, text }` |

### 1d. `backend/routes/paymentProofRoutes.js`

| Method | Path | Auth | Limiter | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|---|
| POST | `/api/payment-proofs` (json limit 4 MB) | cookie (admin or sub-admin for own customers; checked in handler) | `api` | N | `C/Admin/PaymentProof.js` | `{ kind, refId, userId, note, smsText, image(base64 data-url), attachToLatest }` | `201 { message, proof:{…, file:{mime,size}} }` |
| GET | `/api/payment-proofs?kind&refId(csv)&userId&subAdminId` | cookie | — | n/a | PaymentProof.js | query | `{ proofs:[…] }` |
| GET | `/api/payment-proofs/:id/file` | cookie | — | n/a | PaymentProof.js | — | image bytes |

### 1e. `backend/routes/assignmentRequestRoutes.js`

| Method | Path | Auth | Limiter | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|---|
| POST | `/api/me/assignment-requests` | cookie | `api` | N | `C/User/ChangeMouzasModal.js` | `{ add:[mouza], remove:[mouza] }` | `201 { message, request, link:'<origin>/admin/activate/<token>', whatsappText, whatsappNumber, providerName }` |
| GET | `/api/me/assignment-requests/current` | cookie | — | n/a | ChangeMouzasModal | — | `{ request\|null }` |
| DELETE | `/api/me/assignment-requests/current` | cookie | — | N | ChangeMouzasModal | — | `{message}` |
| GET | `/api/assignment-requests` | cookie (admin/sub-admin scoping in handler) | — | n/a | not referenced in src | — | `{requests}` |
| GET | `/api/assignment-requests/user/:userId(*)` | cookie | — | n/a | `C/User/UserEditForm.js` | — | `{ request\|null, invoicesEnabled }` |
| POST | `/api/assignment-requests/:id/approve` / `confirm-payment` / `reject` | cookie | — | N | UserEditForm (`:path` = approve\|confirm-payment\|reject) | approve: `{ fee? }` | `{message, request}` |

### 1f. `backend/routes/geoRoutes.js`

| Method | Path | Auth | Limiter | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|---|
| GET | `/api/tehsil-list` | maybe | `api` | n/a | `lib/mouzaApi.js` | — | `[ "Tehsil", … ]` (strings) |
| GET | `/api/mauza-list/:tehsil` | maybe + `pathParamValidation` | `api` | n/a | `lib/mouzaApi.js`, `utils/userUtils.js`, `C/Admin/SubAdminMouzaPicker.js` | — | `[ "Mouza", … ]`; 404 `{message}` |
| GET | `/api/geojson/:tehsil/:mauza?t=` | cookie + subOrZoom | `geo` | n/a | `C/Map/Core/hooks/useGeoJsonLayer.js` (fallback after static `/JSON Murabba`) | `?z=` honoured for expired users | GeoJSON FeatureCollection |
| POST | `/api/geojson/:tehsil/:mauza/shift` | admin + subOrZoom | `geo` | N | not referenced in src | `{ dx, dy }` (metres) | `{success,message}` |
| POST | `/api/geojson/:tehsil/:mauza/reset` | admin + subOrZoom | `geo` | N | not referenced | — | `501` |
| GET | `/api/offset/:tehsil/:mouza` | cookie | — | n/a | not referenced in src | — | `{latOffset,lngOffset}` |
| POST | `/api/offset/:tehsil/:mouza` | admin | — | N | not referenced | `{latOffset,lngOffset}` | `{success,message,offset}` |
| GET | `/api/geo/adjustment/:tehsil/:mauza` | maybe | — | n/a | `App.js`, `C/Map/Core/ShiftMouzaForm.js` | — | `{ latOffset, lngOffset, isDefault? , … }` |
| POST | `/api/geo/adjustment/:tehsil/:mauza` | cookie + subscribed | — | N | ShiftMouzaForm | `{ latOffset, lngOffset }` (degrees, capped) | `{ success, message, adjustment… }` |
| DELETE | `/api/geo/adjustment/:tehsil/:mauza` | cookie + subscribed + pathParamValidation | — | N | `App.js`, ShiftMouzaForm | — | `{ success, … }` |
| GET | `/api/geo/shifted-mouzas/:tehsil` | maybe | — | n/a | `App/Header.js` | — | `[ "Mouza", … ]` |
| GET | `/api/shajra-tiles/:tehsil/:mouza/:z/:x/:y.png` | cookie + subOrZoom + pathParamValidation | — | n/a | `C/Map/Core/MapComponent.js` (fetch with `credentials:'include'`, cached in IndexedDB `tiles`) | — | PNG via `sendFile` |
| GET | `/api/geo/ip-lookup?ip=` | admin | `api` | n/a | `utils/statsUtils.js` | — | `{ city, region, country, lat, lon, … }` |
| GET | `/pmtiles/:tehsil/:mouza.pmtiles` | cookie + subOrZoom + pathParamValidation | — | n/a | fallback URL in `VectorTileLoader.js`, `usePMTilesLoader.js` (only when backend signed-URL call fails) | Range | file via `sendFile` (NB: this router route is matched **before** the `/pmtiles` static mount in server.js for 2-segment paths incl. `<mouza>-complete.pmtiles`; 3-segment murabba paths fall through to the static handler) |
| POST | `/api/pmtiles/signed-url` | cookie + subOrZoom | — | N | `config/pmtiles.js getSignedUrlFromBackend` | `{ tehsil, mouza?, murabba?, filename? }` | `{ success, url, expiresAt(ms) }` |
| POST | `/api/pmtiles/signed-urls` | cookie + subOrZoom | — | N | `config/pmtiles.js getBatchSignedUrls` | `{ files:[{tehsil,mouza?,murabba?,filename?}] }` (≤50) | `{ success, urls:[{url,path,expiresAt}\|{error,fileSpec}] }` (positional) |

### 1g. `backend/routes/dataRoutes.js`

| Method | Path | Auth | Limiter | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|---|
| POST | `/api/user-layers` | cookie + `createUserLayerValidation` | — | N | `hooks/useUserLayers.js` | `{ name, geojson }` (max 30 layers) | `201 layer {_id,userId,name,geojson,updatedAt}` |
| GET | `/api/user-layers` | cookie | — | n/a | useUserLayers | — | `[layers]` |
| PUT | `/api/user-layers/:id` | cookie + validation | — | N | useUserLayers | `{ name, geojson }` | layer |
| DELETE | `/api/user-layers/:id` | cookie + `layerIdValidation` | — | N | useUserLayers | — | `{success:true}` |
| GET | `/api/landrecords/tehsils` / `mauzas/:tehsil` / `khewats/:tehsil/:mauza` / `details/:khewatId` | cookie | — | n/a | **not referenced in src** | — | arrays / record |

### 1h. `backend/routes/subscriptionRoutes.js`

| Method | Path | Auth | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|
| POST | `/api/subscriptions/:userId/activate-trial` | admin | N | `C/User/UserList.js` | — | `{message, user…}` |
| POST | `/api/subscriptions/:userId/activate-monthly` | admin | N | UserList | — | `{…}` |
| POST | `/api/subscriptions/:userId/activate` | admin | N | UserList, UserEditForm | `{ type }` | `{…}` |

### 1i. `backend/routes/notificationRoutes.js`

| Method | Path | Auth | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|
| GET | `/api/notifications` | cookie | n/a | `AuthContext` (boot, every 12 s, focus/visibility) | — | `{ notifications:[{ id, type, title, message, timestamp, read, action?, replyTo?, details?, actionDone }] }` (latest 60) |
| POST | `/api/notifications/:id/read` | cookie | N | `AuthContext.markNotificationAsRead` | `{}` | `{success}` |
| POST | `/api/notifications/read-all` | cookie | N | `AuthContext.markAllNotificationsAsRead` | `{}` | `{success}` |
| POST | `/api/notifications/subscribe` | cookie | N (NOT exempt despite comment) | `utils/pushSetup.js` | `{ subscription: PushSubscriptionJSON }` | `201 {success}` |
| POST | `/api/notifications/unsubscribe` | cookie | N | `utils/pushSetup.js` (on logout) | `{ endpoint }` | `{success}` |
| GET | `/api/notifications/vapid-public-key` | public | n/a | pushSetup | — | `{ publicKey }` (503 if push unavailable) |
| GET | `/api/notifications/:id/reply-info` | cookie (admin/subadmin) | n/a | `App/ReplyModal.js` | — | `{ customer: snapshot, provider, signOff, details }` |
| POST | `/api/notifications/:id/reply` | cookie (admin/subadmin) | N | ReplyModal | `{ message }` | `{message}` |
| DELETE | `/api/notifications` | cookie | N | `AuthContext.clearNotifications` | — | `{success}` |

### 1j. `backend/routes/locationRoutes.js`

| Method | Path | Auth | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|
| ALL | `/api/heartbeat` (also `/heartbeat`) | **none** (decodes `authToken` without verifying) | Y | `AuthContext` every 60 s | `{ deviceId, deviceSignature, deviceLabel, location?:{latitude,longitude,accuracy,source} }` | `{ success:true, locationUpdated? }` or `{status:'ok', authenticated:false}` |
| GET | `/user-locations/:userId` | admin | n/a | `C/Map/LocationComponents.js`, `UserDetails.js`(dead) | — | `{ userId, userName, locations }` |
| GET | `/location-heatmap` | admin | n/a | LocationComponents | — | `{ total, points }` |
| GET | `/location-stats` | admin | n/a | LocationComponents | — | `{…}` |

### 1k. `backend/routes/statsRoutes.js`

| Method | Path | Auth | Limiter | Used by | Response |
|---|---|---|---|---|---|
| GET | `/stats` | admin | — | `C/Admin/EnhancedStatistics.js` | stats object (cached) |
| GET | `/api/visit.gif?p=home` | public | `api` | **marketing site** (`www.naqsha-zameen.pk`), not the SPA | 1×1 GIF |
| GET | `/stats/visitors?p=home` | admin | — | `C/Admin/StatsTabs/VisitorsTab.js` | summary |
| GET | `/online-users` | admin | — | EnhancedStatistics | `[ {userId, userName, mouzas, subscriptionType, ipAddress, ipCount, deviceCount, sameTimeDevices, devices, instances, start, lastActive} ]` |
| GET | `/multi-device-users` | admin | — | EnhancedStatistics | list |
| GET | `/subscription-stats` | admin | — | EnhancedStatistics | `{ total, direct, fromSubAdmins, … }` |
| GET | `/user-ip-history/:userId` | admin | — | EnhancedStatistics | `{ userId, userName, ipHistory }` |

### 1l. `backend/routes/tehsilGroupRoutes.js`

| Method | Path | Auth | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|
| GET | `/api/tehsil-groups` | maybe | n/a | `lib/mouzaApi.js fetchTehsilGroups` | — | `[ {_id, canonicalName, aliases:[…], …} ]` |
| GET | `/api/admin/tehsil-groups` | admin | n/a | `C/Admin/TehsilGroupingModal.js` | — | same |
| POST | `/api/admin/tehsil-groups` | admin | N | TehsilGroupingModal | `{ canonicalName, aliases:[≥2] }` | `201 {message, group}` |
| PUT | `/api/admin/tehsil-groups/:id` | admin | N | TehsilGroupingModal | same | `{message, group, usersUpdated}` |
| DELETE | `/api/admin/tehsil-groups/:id` | admin | N | TehsilGroupingModal | — | `{message, usersUpdated}` |

### 1m. `backend/routes/landAllotmentRoutes.js` (admin only)

| Method | Path | Used by | Request | Response |
|---|---|---|---|---|
| GET | `/api/admin/land-allotments?page&limit&sortKey&sortDir&…` | `C/Admin/LandAllotmentTool.js` | query | `{ records, pagination }` |
| GET | `/api/admin/land-allotments/search?cnic\|name` | LandAllotmentTool | query | `{ results }` |
| GET | `/api/admin/land-allotments/:id/geometry` | LandAllotmentTool | — | `{ geometry… }` |
| GET | `/api/admin/land-allotments/:id/export.kmz` | LandAllotmentTool | — | KMZ bytes |
| GET | `/api/admin/land-allotments/:id` | LandAllotmentTool | — | `{ record }` |

### 1n. `backend/routes/reportRoutes.js`

| Method | Path | Auth | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|
| POST | `/api/admin/reports/generate` | admin | N | `C/Admin/OperationsReportTool.js` | `{ startDate, endDate }` (YYYY-MM-DD) | `{ message, pdfGenerated, reportDate, … }` |

### 1o. `backend/routes/configRoutes.js` (mounted at `/api/config`)

| Method | Path | Auth | CSRF | Used by | Request | Response |
|---|---|---|---|---|---|---|
| GET | `/api/config` | cookie + `isSelfOrAdmin` (no `:userId` param → effectively admin only) | n/a | `App/NavigationMenu.js` | — | `{ key: value, … }` |
| PUT | `/api/config` | same | N | NavigationMenu | `{ limitsEnabled: bool, … }` | `{message}` |
| GET | `/api/config/public` | public | n/a | not referenced in src | — | `{ limitsEnabled }` |

### 1p. Routes defined directly in `backend/server.js`

| Method | Path | Auth | Limiter | CSRF | Used by | Response |
|---|---|---|---|---|---|---|
| GET | `/api/csrf-token` | public | `api` | n/a | `AuthContext` (module load + lazily before any mutating request) | `{ csrfToken }` + httpOnly companion cookie `x-csrf-token` |
| GET | `/health` | public | — | n/a | nobody in SPA (only a comment in `RenewalsTab.js`) | `{status,timestamp,uptime,mongodb,version}` |
| GET | `/*` (SPA catch-all) | public | — | n/a | browser | `build/index.html` when `../build` exists; `/api*` and `/health` excluded |
| static | `/` (express.static of `../build`, 1 d cache) | public | — | — | browser | hashed assets, `/meta.json`, `/push-sw.js`, icons |

### 1q. Static data routes (server.js) — all `verifyAuthCookie` + `checkTehsilAccessForStatic` + `linkedTehsilRewrite` + case-insensitive file lookup

`verifyAuthCookie` = `authToken` cookie JWT verify + `tokenVersion` DB check (401 otherwise). `checkTehsilAccessForStatic` = admin passes; else first path segment (or `<Tehsil>-Mouza-Index.json` prefix) must be in the user's `tehsilAccess` (linked-tehsil aware) → else 403. Files live under `backend/data/<sub>/`. Compression is skipped for these prefixes. **No CSRF (GET).**

| Prefix | Files the SPA requests | Used by |
|---|---|---|
| `/Metadata` | `/<Tehsil>/<Tehsil>-Mouza-Index.json`, `/<Tehsil>/<Mouza>-Murabba.json`, `-Killa.json`, `-Metadata.json`, `/<Tehsil>/<Mouza>.json`, `/list-tehsils.json` (probe) | `lib/mouzaApi.js`, `App.js` (axios `/Metadata/<activeTehsil>/<mouza>.json`), `C/Map/Core/hooks/useFallbackGeoJSON.js`, `loadMurabbaPMTiles.js` |
| `/JSON Murabba` and `/JSON%20Murabba` | `/<Tehsil>/<Mouza>.geojson?t=`, `/<Tehsil>/<Mouza>/<Murabba>.geojson` | `useGeoJsonLayer.js`, `VectorTileLoader.js`, `GeoJsonLoader.js`, `useFallbackGeoJSON.js`, `loadMurabbaPMTiles.js`, `geoJsonTransform.js`, `GeoJsonInteractionLayer.js`(dead) |
| `/Shajra Parcha` | `/<Tehsil>/<Mouza>.json?t=` (shajra meta), `/<Tehsil>/<Mouza>.geojson?t=` (labels) | `MapComponent.js` (`encodedBase = encodeURIComponent('Shajra Parcha')`) |
| `/tiles` | — | **not used by the SPA** (shajra tiles go through `/api/shajra-tiles/...`) |
| `/pmtiles` | `/<Tehsil>/<Mouza>.pmtiles`, `/<Tehsil>/<Mouza>-complete.pmtiles`, `/<Tehsil>/<Mouza>/<Murabba>.pmtiles` | only as *fallback* when signed-URL fetch fails (`VectorTileLoader.js:1368`, `usePMTilesLoader.js:150`, `config/pmtiles.js getFrontendPMTilesUrl`) — extra rule: request must carry `Range: bytes=N-M` with an explicit end, else 403 `{message:'Full file download not permitted'}`; headers `Accept-Ranges`, `Cache-Control: private, max-age=3600` |

All of these are fetched with `credentials:'include'` and relative to `REACT_APP_API_URL`; on localhost the fetch shim in `AuthContext.js` rewrites `https://api.naqsha-zameen.pk` → relative so the CRA proxy (`"proxy": "http://localhost:5000"` in package.json) forwards them.

---

## 2. Auth / session model

### 2.1 Cookies (set by backend; browser never reads them — all `httpOnly`)

| Cookie | Set by | Value | Attributes (prod) | Lifetime |
|---|---|---|---|---|
| `authToken` | `/api/login`, `/api/admin/login-as`, `/demo-access/:token`, `/api/logout` (restores admin) | JWT | `httpOnly; Secure; SameSite=None; Domain=.naqsha-zameen.pk; Path=/` | 30 d (`maxAge`); demo link: remaining link validity |
| `adminAuthToken` | `/api/admin/login-as` | the impersonating admin's/sub-admin's original JWT | same | 30 d; cleared by any real login, logout, reset-password |
| `x-csrf-token` | `/api/csrf-token` | random nonce (companion only; validation is header-only) | same, httpOnly | session |
| `did` | `/api/login` (non-admin) via `services/deviceTracker.recordLogin` | device id (UUID from page or server) | httpOnly + same secure/sameSite/domain | 2 years |

Domain/SameSite derivation (`server.js`, `middleware/authMiddleware.js`): `COOKIE_DOMAIN` env, else when prod (`NODE_ENV=production` or Linux / `CORS_ORIGIN` https) `'.' + last two labels of CORS_ORIGIN hostname` → `.naqsha-zameen.pk`; `COOKIE_SAMESITE` env else `none` in prod / `lax` in dev; `Secure` forced when prod or SameSite=None. Dev (Windows, `CORS_ORIGIN` unset): no domain, `SameSite=Lax`, not Secure.

The frontend also *defensively deletes* any non-httpOnly `authToken` on boot (`AuthContext` first effect) and in `clearAppData` wipes every readable cookie across `''`, host, `.host`, `.naqsha-zameen.pk`, `dashboard.naqsha-zameen.pk`, `api.naqsha-zameen.pk`. `C/Auth/ResetPassword.js:41-45` does the same for its cookie names.

### 2.2 JWT

- `jwt.sign({ userId, tokenVersion }, SECRET_KEY, { expiresIn:'30d' })` for login/impersonate. Demo access: `{ userId }` only (no tokenVersion), `expiresIn` = seconds left on the link.
- Claims: `userId`, `tokenVersion`, `iat`, `exp`. **No `userType` in the token** — `socketService` reads `decoded.userType` to join the `admins` room, which therefore never happens (admins still get notifications through their per-user room because `notifyAdmins` fans out with `sendNotification`).
- `tokenVersion`: `User.tokenVersion` (default 0). `isAuthenticated` and `verifyAuthCookie` reject when `decoded.tokenVersion !== user.tokenVersion` (unless undefined in token → demo tokens pass). Bumped by `/api/reset-password` (and admin flows that reset passwords). Any bump invalidates all cookies for that user.
- `isAuthenticated` tolerates duplicate `authToken` cookies (parses raw `Cookie` header, tries each). On failure it clears `authToken` + `adminAuthToken` (both domain and host-only variants) and returns 401 `{message:'User session not found. Please log in again.'}`.
- `req.user` for `isAuthenticated` = `{ userId, userType, tokenVersion, tehsilAccess, activeTehsil, status, subscriptionType, startDate, endDate }` (lean). `maybeAuthenticated` sets `{userType,userId}` only.

### 2.3 CSRF (stateless double-submit, custom, `server.js`)

- Token = `nonce + '.' + HMAC_SHA256(SECRET_KEY, nonce + ':' + sessionId)` with `sessionId = req.cookies.authToken || 'anonymous'`. So the token is **bound to the current authToken cookie value** → must be refetched after login, logout, login-as, password change.
- Fetch: `GET /api/csrf-token` → `{ csrfToken }`. Send: header `x-csrf-token` on POST/PUT/PATCH/DELETE. `allowedHeaders` includes it.
- Exempt prefixes (`req.path === p || startsWith(p)`): `/register`, `/api/register`, `/login`, `/api/login`, `/logout`, `/api/logout`, `/admin/login-as`, `/api/admin/login-as`, `/forgot-password`, `/api/forgot-password`, `/reset-password`, `/api/reset-password`, `/demo-access/`, `/health`, `/heartbeat`, `/api/heartbeat`.
- Failure: `403 {error:'CSRF token missing'|'CSRF token malformed'|'CSRF token validation failed'}`. Frontend: axios request interceptor lazily fetches the token and attaches it to mutating requests; response interceptor nulls the cached token on any 403 (so the next mutating call refetches). The token is NOT refetched automatically after login — `login()` sets `csrfToken = null` so the next POST fetches a fresh one.

### 2.4 Flows

**Login** (`AuthContext.login`): if another user is cached and the typed id differs → `switchAccount()` (`POST /api/logout {clearAll:true}` + local reset). Then `POST /api/login {...credentials, deviceId, deviceSignature, deviceLabel}`. If `needsOTP` → return `{needsOTP, message}` (Login.js shows OTP modal and re-posts with `otp`). Else `fetchUserProfile()` (`GET /api/profile` + `GET /api/notifications` in parallel) → `sessionStorage.user`, `csrfToken=null`, `navigate('/')`. Errors: 429 → `modalError`, 401 → `error` text, else `error` from body.

Login.js extras: `?t=<base64 JSON {u,p}>` quick-login prefill (generated by `C/Common/PasswordResetModal.js` as `${origin}/login?t=`), `location.state.prefill`, remembers `localStorage.userId`, removes legacy `localStorage.password`.

**Logout**: `disablePushForThisAccount()` (`POST /api/notifications/unsubscribe {endpoint}`), `POST /api/logout {}` → if `adminRestored` → `fetchUserProfile()` + `navigate('/')` (back to admin); else clear state/sessionStorage, `csrfToken=null`, `navigate('/login')`.

**Login-as / impersonate** (`loginAs(userId)`): `POST /api/admin/login-as/:userId` (admin, or sub-admin for own customer; CSRF exempt; `strict` limiter) → cookies swapped; frontend wipes session state, `csrfToken=null`, `fetchUserProfile()`, `navigate('/')`. Ending: plain logout returns `adminRestored:true`. A real `/api/login` always clears `adminAuthToken`.

**switchAccount**: `POST /api/logout {clearAll:true}` + `resetLocalSession()` (no navigation). Used by Login.js when a quick-login/activation link targets a different account.

**clearAppData**: logout clearAll → delete all readable cookies → `sessionStorage.clear()`, `localStorage.clear()` (preserving `geo_device_id`) → delete every IndexedDB (incl. `tiles`) → delete all CacheStorage → disconnect socket → `window.location.href='/login'`.

**Demo access**: SPA route `/demo/:token` (`C/Admin/DemoAccess.js`) does `window.location.replace(`${REACT_APP_API_URL||origin}/demo-access/${token}`)`; backend sets cookie and 302s to the dashboard root; `AuthProvider` boot `fetchUserProfile()` hydrates.

**Password reset**: email link `${FRONTEND}/reset-password?token=`; SPA route `/reset-password` (`C/Auth/ResetPassword.js`) posts `{token,password}`; `AuthProvider` skips hydration on `/reset-password` paths and clears `sessionStorage.user`.

**Email verification** (public registration): `${FRONTEND}/verify-email?token=` → `C/Auth/VerifyEmail.js` GETs `/api/verify-email?token=` then navigates to `/login` with `sessionStorage.pending_activation_creds` prefill.

**Sub-admin program links** (`services/subAdminEmails.js`): `/activate/<token>` (customer), `/subadmin/activate/<token>`, `/confirm-email/<token>` → `C/Admin/ActivationPages.js`. Renewal/assignment action links `/admin/activate/<token>` → `C/Admin/AdminActivate.js` (`GET /api/admin/resolve-token/:token`).

### 2.5 Heartbeat

`POST /api/heartbeat` with `getDevicePayload()` immediately on login and every 60 s while `user` is set (`AuthContext` effect). No auth middleware; backend `jwt.decode`s the cookie (no signature check), `deviceTracker.touch()` marks the device active (two devices within 5 min = "same time" → `concurrentCount`), buffers `lastActive` in Redis hash `heartbeats` (flushed by a job) or writes `User.lastActive` directly. Optional `location` updates the open `Session`. **The SPA never sends `location`** (grep shows only device fields).

### 2.6 Device fingerprinting & multi-use ("ipMisuse")

- `utils/deviceUtils.js`: `geo_device_id` UUID in localStorage (persisted across `clearAppData`), `getDeviceSignature()` = FNV-1a hash of platform/UA-platform/type/screen/DPR/timezone/language/cores/memory/touch/GPU renderer → 16 hex, `getDeviceLabel()` = "Android · Chrome · 412×915". Sent on login, heartbeat, registration (`deviceId`), customer activation (`deviceId`).
- Backend `services/deviceTracker.js`: `Device` docs per user (`deviceIds[]`, `signature`, `label`, `ips[]`, `lastConcurrentAt`, `concurrentCount`, `forgotten`), matched by id → `did` cookie → signature. `usageForOne(user)` produces the legacy-shaped `ipMisuse` object on the profile: `{ count30, count7, ips30:[labels], ips7, deviceCount30, devices30:[{id,label,firstSeen,lastSeen,logins,networks,sameTime}], concurrent30, warn (count30>3 || concurrent30>0), activationStart, basis:'devices' }`. Admin can "forget" a device (`POST /api/users/:id/devices/:deviceId/forget`). Daily job `multiUseWarning` notifies offenders. Impersonated sessions are excluded.
- Frontend: `ipMisuse` state in AuthContext (hydrated from `sessionStorage.user.ipMisuse`), shown by `App/Modals/IPMisuseModal.js`, `C/User/UserEditSections/MultiUseSection.js`.

### 2.7 Profile payload (`GET /api/profile`)

`sanitizeUser(User)` minus `password, passwordPlain, resetPasswordToken/Expires, verificationToken, otp, notifications, pushSubscriptions`; plus derived `tehsilAccess:[{tehsil,mouzas,tempGrants}]`, `activeTehsil`, `tehsil` (legacy), `mauzaList` (= active entry mouzas), recomputed `status/endDate/daysRemaining`, `ipMisuse` (non-admin), `provider` (`{name,jazzcash,easypaisa,phone,whatsapp,bank?,…}`), `activation:{activatedAt,expiresAt}`, `pendingEmail:{email}`, `subAdminStatus` (sub-admins), expanded mouza list for sub-admins. Other fields straight from the User model: `userId, userName, email, mobileNumber, userType ('user'|'subadmin'|'admin'), status, subscriptionType, startDate, endDate, daysRemaining, fee, managedBy, createdBy, planTier, paidPeriod, customMouzaLimit, customPlatformPrice, renewalHistory, renewalCount, warnings, lastActive, isFirstLogin, registrationSource, isPublicRegistration, tokenVersion, …`.

Frontend `normalizeUserData()` guarantees `tehsilAccess[]`, `activeTehsil`, `mauzaList`, `activeMauzas`.

### 2.8 What `AuthContext` exposes (`useAuth()`)

Values: `user`, `userType`, `loading`, `error`, `modalError`, `warning`, `needsEmail`, `ipMisuse`, `notifications`, `realtimeNotification`, `unreadNotificationsCount`.
Setters: `setModalError`, `setWarning`, `setNeedsEmail`, `setIpMisuse`, `setRealtimeNotification`.
Functions: `login(credentials)`, `logout()`, `switchAccount()`, `loginAs(userId)`, `clearAppData()`, `setActiveTehsil(tehsil)`, `changePassword(old,new)`, `fetchUserProfile()`, `markNotificationAsRead(id)`, `markAllNotificationsAsRead()`, `clearNotifications()`.
Also exported from the module: `getApiBaseUrl()` (localhost → `http://localhost:5000`, else `REACT_APP_API_URL || 'https://api.naqsha-zameen.pk'`).

`warning` object (`buildSubscriptionWarning`): `{ type:'payment'|'expiring-soon', title, message, userName, startDate, endDate?, daysRemaining?, status }` — `payment` when `status` Pending/Expired, `expiring-soon` when `daysRemaining ≤ 5` and not Permanent; never for admins.

### 2.9 Side effects run by `AuthProvider` (module + mount)

1. Module scope: `axios.defaults.withCredentials = true`; localhost `window.fetch` shim rewriting `https://api.naqsha-zameen.pk` → relative; initial `fetchCsrfToken()`; axios request interceptor (localhost URL rewrite + CSRF header) and response interceptor (403 → drop token).
2. Mount: delete client-side `authToken` cookies; if path starts `/reset-password` → `loading=false` and skip; else `fetchUserProfile()`.
3. `user?.userId` set → `setupPush()` (register `/push-sw.js`, request permission on first click/touch, subscribe, `POST /api/notifications/subscribe`).
4. `user` set → initial `GET /api/notifications`, `setInterval` 12 s, `visibilitychange`/`focus` refetch; `io(getApiBaseUrl(), {...})` connect; `Notification.requestPermission()` if default; `socket.on('notification')`. Cleanup on user change/unmount disconnects socket and clears interval/listeners.
5. `user` set → heartbeat POST now + every 60 s.
6. `fetchProfileRef` kept current so socket handler can trigger `fetchUserProfile()` on `subscription|activation|profile` typed notifications (or title containing "subscription"), which also sets `realtimeNotification` (shown by `App/Modals/RealtimeNotificationModal.js`).
7. Navigation: `login`→`/`, `logout`→`/login` (or `/` if admin restored), `loginAs`→`/`, `clearAppData`→hard `/login`.
8. Storage: `sessionStorage.user` (full normalized profile — also read by `lib/logger.js` to gate console output to admins), `localStorage.geo_device_id`.

---

## 3. Socket.io and push

### 3.1 Socket.io

- Client (`AuthContext`): `io(getApiBaseUrl(), { withCredentials:true, transports:['websocket','polling'], reconnection:true, reconnectionAttempts:Infinity, reconnectionDelay:2000, timeout:10000 })`. Default path `/socket.io`. One socket per logged-in user; disconnected on logout/user change.
- Server (`services/socketService.js`): CORS allow-list `https://dashboard.naqsha-zameen.pk`, `https://api.naqsha-zameen.pk`, `http://localhost:3000`, `http://localhost:5000`, `CORS_ORIGIN`, any `http://localhost:*` / `http://127.0.0.1:*`; `credentials:true`; `perMessageDeflate` threshold 1 KB; Redis adapter when Redis is up (pm2 cluster). Handshake middleware parses `Cookie: authToken` → `jwt.verify` → `socket.userId` (no tokenVersion check) → joins room `user_<userId>`; `admins` room is dead (see §2.2). No client-supplied auth payload.
- Events:

| Direction | Event | Payload |
|---|---|---|
| server → client | `notification` | `{ id, type:'subscription'\|'profile'\|'alert'\|'info'\|'activation', title, message, timestamp, read:false, action?:{label,url,kind,ref}, actionDone?, replyTo?, details? }` (from `utils/notificationUtils.sendNotification`); `emitToAdmins` sends the same minus `id` |
| client → server | *none* (client only listens; also `connect`, `connect_error` built-ins) | — |

### 3.2 Web Push

- Service worker `public/push-sw.js` (no fetch handler / no caching): `push` → `showNotification(title, {body, icon:/logo192.png, badge:/favicon.png, tag, renotify, vibrate, data:{url,notificationId}})`; `notificationclick` → focus/navigate an open same-origin tab to `data.url` or `openWindow`.
- `utils/pushSetup.js`: `navigator.serviceWorker.register('/push-sw.js')`; `GET /api/notifications/vapid-public-key` → `{publicKey}`; replace subscription if key changed; `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})`; `POST /api/notifications/subscribe {subscription}`; sets `window.__pushEnabled=true` so AuthContext does not also show a local `Notification` for socket events. On logout `POST /api/notifications/unsubscribe {endpoint}`.
- Backend `services/pushNotificationService.js`: VAPID keys from `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY` env, else generated once and stored in `SystemConfig{key:'vapidKeys'}`; contact `mailto:admin@naqsha-zameen.pk`; payload `{ title, body:message, tag:id, data:{url: action.url || '/', notificationId} }`, TTL 24 h, urgency high; 404/410/401/403 → subscription dropped. Sent via BullMQ `pushQueue` when Redis, else inline. Subscriptions stored on `User.pushSubscriptions` (max 10; an endpoint is moved between accounts on subscribe).
- `C/Common/VersionChecker.js` unregisters every service worker **except** `/push-sw.js` on boot.

---

## 4. Frontend env vars

Current `.env` (repo root, gitignored but present):
```
REACT_APP_API_URL=https://api.naqsha-zameen.pk
REACT_APP_PMTILES_MODE=cloudflare
REACT_APP_CLOUDFLARE_WORKER_URL=https://pmtiles-worker.mallhintdr.workers.dev
REACT_APP_METADATA_BASE_URL=https://api.naqsha-zameen.pk/Metadata
REACT_APP_PMTILES_BASE_URL=https://pmtiles-worker.mallhintdr.workers.dev
REACT_APP_TURNSTILE_SITE_KEY=0x4AAAAAADJklyYTaLt5RK7P
COOKIE_DOMAIN=.naqsha-zameen.pk
DANGEROUSLY_DISABLE_HOST_CHECK=true
```

| Var | Read in | Verdict for Vite |
|---|---|---|
| `REACT_APP_API_URL` | 60+ files (every API call: AuthContext, mouzaApi, pmtiles config, all components) — usually `${REACT_APP_API_URL}/api/...` or `process.env.REACT_APP_API_URL \|\| ''` ; some fall back to `'http://localhost:5000'` (`config/pmtiles.js`, `App.js:198,583`, `MapComponent.js:1306`) | **→ `VITE_API_URL`** (single API base; replace the scattered fallbacks with one helper) |
| `REACT_APP_METADATA_BASE_URL` | `lib/mouzaApi.js` (5), `C/Map/Core/loadMurabbaPMTiles.js` | redundant: equals `${API_URL}/Metadata`; keep only if a CDN is ever used → optional `VITE_METADATA_BASE_URL` |
| `REACT_APP_CLOUDFLARE_WORKER_URL` | `config/pmtiles.js` (listing fallback `/list-tehsils`), `config/pmtiles-simple.js` (dead) | **→ `VITE_CLOUDFLARE_WORKER_URL`** (only for the R2 `/list-tehsils` merge; signed URLs come from the backend already pointing at the worker) |
| `REACT_APP_PMTILES_MODE` | `config/pmtiles.js getPMTilesMode/isPMTilesConfigured` (import only in mouzaApi) | **dead in effect**: `getSignedPMTilesUrl` always asks the backend regardless of mode; drop |
| `REACT_APP_PMTILES_BASE_URL` | nowhere | **dead** |
| `REACT_APP_TURNSTILE_SITE_KEY` | `C/Auth/PublicUserRegistration.js` | **→ `VITE_TURNSTILE_SITE_KEY`** |
| `REACT_APP_WHATSAPP_NUMBER` | `C/User/ChangeMouzasModal.js`, `C/Common/SubscriptionWarningBanner.js`, `App/Modals/SubscriptionWarningModal.js` (fallback only; not set in .env) | dead — backend `provider.whatsapp` (default `923048840264` in `services/providerService.js`) supersedes |
| `REACT_APP_FORCE_FRONTEND` | `config/pmtiles-simple.js` (dead file) | dead |
| `COOKIE_DOMAIN`, `DANGEROUSLY_DISABLE_HOST_CHECK` | not `REACT_APP_*` → never inlined by CRA; latter is a CRA dev-server flag | dead for Vite (backend has its own `COOKIE_DOMAIN`) |
| `NODE_ENV` | `config/pmtiles.js` log, others | → `import.meta.env.DEV/PROD` |
| `PUBLIC_URL` | `public/index.html` only | → Vite `base` / `/` |
| `package.json "proxy": "http://localhost:5000"` | CRA dev proxy for relative calls | → `server.proxy` for `/api`, `/socket.io`, `/Metadata`, `/JSON Murabba`, `/JSON%20Murabba`, `/Shajra Parcha`, `/pmtiles`, `/tiles`, `/demo-access`, `/stats`, `/online-users`, `/multi-device-users`, `/subscription-stats`, `/user-ip-history`, `/user-locations`, `/location-heatmap`, `/location-stats`, `/health` |

Backend references to `REACT_APP_*`: `middleware/signedPMTilesUrl.js:5` reads `CLOUDFLARE_WORKER_URL || REACT_APP_CLOUDFLARE_WORKER_URL` (so the backend `.env` may rely on the REACT_APP name — keep `CLOUDFLARE_WORKER_URL` set); `services/providerService.js:12` comment only.

---

## 5. PMTiles delivery

- **Modes** (`src/config/pmtiles.js`): `'local'` = backend `/pmtiles/...` (cookie + Range-only); `'cloudflare'` = R2 bucket `geo-dashboard-pmtiles` behind Worker `pmtiles-worker` (`https://pmtiles-worker.mallhintdr.workers.dev`, account `22d46ada0d50df7bc038985cdcb55de2`). In practice `getSignedPMTilesUrl()` **always** `POST /api/pmtiles/signed-url` (or batch) and only falls back to `/pmtiles/...` (relative, so same host as the SPA) when that fails — mode is informational.
- **Signing** (`backend/middleware/signedPMTilesUrl.js`): `PMTILES_SIGNING_KEY` (backend env; Worker secret via `wrangler secret put PMTILES_SIGNING_KEY`), `exp = now+3600 s`, `relativePath` = `T/filename` | `T/M/<murabba with / → ->.pmtiles` | `T/M.pmtiles`, linked-tehsil resolution (`utils/linkedTehsilPath.resolveTehsilForMouza`) so the path names the tehsil folder that actually holds the mouza in R2; `token = HMAC_SHA256(key, "<path>|<exp>|<userId>")`; URL `${CLOUDFLARE_WORKER_URL}/<encoded path>?token=&exp=&uid=`. Frontend caches signed URLs 15 min (`signedUrlCache`, 4 min safety buffer), batch ≤ 50.
- **Worker endpoints**:
  - `pmtiles-worker.js` (full, HMAC): `OPTIONS` preflight; `GET /list-tehsils` → `["Tehsil",…]` (sorted, 1 h cache); `GET /list-mouzas/<Tehsil>` → `["Mouza",…]` from `<T>/<T>-Mouza-Index.json` else scan (`X-Source: index|scan`); `GET /<path>-Metadata.json` public (no token); any other `GET /<path>?token&exp&uid` → validate (401 missing params, 403 expired/invalid, 500 no key), per-uid in-memory limit 5000/min (429), Cloudflare cache for full (non-range) responses, `Content-Type: application/vnd.pmtiles`, `Cache-Control: public, max-age=86400, immutable, no-transform`, `X-User-ID`, `X-Cache`. CORS allow-list: `https://dashboard.naqsha-zameen.pk`, `http://localhost:3000`, any origin containing `localhost` → echoes origin + `Allow-Credentials:true`; otherwise `*`. Allowed headers `Content-Type, Range, Authorization`.
  - `pmtiles-worker-simple.js` (**the one `wrangler.toml` deploys**, `main = "pmtiles-worker-simple.js"`): **no token validation** — any `GET /<path>` streams from R2 (`application/x-protobuf` for `.pmtiles`, json for `.json`, 24 h immutable cache); `/health` and `/`; `/list-tehsils` → `{ tehsils:[…] }` and `/list-mouzas/<T>` → `{ mouzas:[…] }` (**object shape, not array** — `lib/mouzaApi.fetchFromR2Worker` requires an array, so with the simple worker the R2 listing merge silently yields nothing). CORS allow-list: `https://dashboard.naqsha-zameen.pk`, `http://localhost:3000`, `http://localhost:5000`, any `http://localhost:*`; else `*`. Exposes `Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified`.
  - `zip-extractor-worker.js`: separate admin tool (`POST /upload-zip` → unzip into R2); not referenced by the SPA.
- The signed `?token=&exp=&uid=` query is harmless on the simple worker. Frontend `fetchFromR2Worker` uses `credentials:'omit'`; PMTiles library range requests go straight to the worker URL (no cookies). Metadata JSON (`<Mouza>-Murabba.json`) can also be pulled from R2 via a signed URL (`tileDecoder.js:83`).
- Also hard-coded worker URL fallback in `config/pmtiles.js getCloudflareListingUrl()` and `config/pmtiles-simple.js`.

---

## 6. Deployment topology today

Two topologies are described by the repo; they do not fully agree.

**A. Split hosts (what `.env`, the PHP helpers, committed `public/static` and the CORS/cookie defaults encode):**
- SPA at `https://dashboard.naqsha-zameen.pk` on the shared "o3" PHP host: CRA build output (`public/static/*`, `public/asset-manifest.json` are a committed copy of a build; `.gitignore` now ignores them) + `public/get_mauza_list.php` and `public/list-metadata-folders.php` next to it. Hashed assets are built with `REACT_APP_API_URL=https://api.naqsha-zameen.pk` so every API/static-data call is cross-origin.
- API at `https://api.naqsha-zameen.pk` on the Hostinger VPS: `pm2 start backend/server.js --name geo-dashboard -i max` (cluster; Redis adapter/rate-limit stores for cross-worker state), MongoDB, optional Redis/BullMQ, data under `backend/data/{Metadata,JSON Murabba,Shajra Parcha,tiles,pmtiles}`, uploads `backend/uploads` (payment proofs, `PAYMENT_PROOF_DIR`).
- Cross-origin requirements the backend already satisfies: CORS allow-list `https://dashboard.naqsha-zameen.pk`, `https://api.naqsha-zameen.pk`, `http://localhost:3000`, `http://localhost:5000`, `CORS_ORIGIN`, any `http://localhost:*`/`127.0.0.1:*`; `credentials:true`; cookies `Domain=.naqsha-zameen.pk; SameSite=None; Secure`; helmet CSP `connect-src 'self' <CORS_ORIGIN> http://localhost:5000 ws://localhost:5000` (CSP only matters when the backend serves the SPA).
- PMTiles from the Cloudflare Worker (third origin), listed above.
- The two PHP helpers: `get_mauza_list.php` is **not referenced anywhere in `src/`** (dead; it proxied `/api/tehsil-list` and `/api/mauza-list` and merged local `JSON Murabba` / `Shajra Parcha` folders on the PHP host). `list-metadata-folders.php` is referenced once (`lib/mouzaApi.js:192`) but is fetched from `${REACT_APP_API_URL}/list-metadata-folders.php` i.e. the **API host**, where Express returns the SPA `index.html` (non-JSON → ignored), and only when backend + worker returned ≤100 tehsils. Effectively dead; neither needs to be reproduced.

**B. Single host (what `deploy.sh` does):** on the VPS `git reset --hard origin/main`, `npm ci` when lockfiles changed, `REACT_APP_API_URL="" BUILD_PATH=build_next GENERATE_SOURCEMAP=false npm run build` (→ `prebuild` bumps version + meta.json), atomic swap to `./build`, `pm2 reload geo-dashboard --update-env` (or `pm2 start backend/server.js --name geo-dashboard -i max --time`). `server.js` serves `../build` with 1-day cache and a SPA catch-all for every non-`/api`, non-`/health` path. With `REACT_APP_API_URL=""` most calls become same-origin relative paths, **but** `config/pmtiles.js`, `App.js:198/583`, `MapComponent.js:1306` use `|| 'http://localhost:5000'` and `AuthContext.getApiBaseUrl()` (CSRF + socket) uses `|| 'https://api.naqsha-zameen.pk'` — so a same-origin build silently targets the wrong hosts for signed URLs/adjustments/shajra tiles unless the dashboard is itself at api.naqsha-zameen.pk. Treat B as aspirational; the rebuild should make the base URL a single explicit setting that works for both.

**Hard-coded domains**
- `src/`: `https://api.naqsha-zameen.pk` (`context/AuthContext.js` ×2: fetch shim regex + `getApiBaseUrl` fallback), `https://dashboard.naqsha-zameen.pk` (`C/Admin/SubAdminUsers.js:56`, `C/Auth/UserRegistration.js:326`, `C/Common/PasswordResetModal.js:24,51` as `window.location.origin` fallbacks), `https://pmtiles-worker.mallhintdr.workers.dev` (`config/pmtiles.js`, `config/pmtiles-simple.js`), `http://localhost:5000` (`config/pmtiles.js`, `App.js`, `MapComponent.js`, AuthContext), localhost/192.168./10. detection in `AuthContext.js`, `useGeoJsonLayer.js:70`, `loadMurabbaPMTiles.js:31`.
- `backend/`: `https://dashboard.naqsha-zameen.pk` (`server.js` CORS default/allow-list, `middleware/authMiddleware.js` cookie-domain derivation, `services/socketService.js`, `controllers/authController.js` demo redirect + logout GET redirect `/login`, `utils/emailUtils.js getFrontendUrl`, `utils/frontendOrigin.js`), `https://api.naqsha-zameen.pk` (`server.js`, `socketService.js` allow-lists), `naqsha-zameen.pk` suffix trust in `frontendOrigin.js`, `mail.naqsha-zameen.pk` (SMTP default in `emailUtils.js`), `www.naqsha-zameen.pk` (`models/PageVisit.js`), `dashboard.naqsha-zameen.pk/api/visit.gif` (comment in `routes/statsRoutes.js`), `admin@naqsha-zameen.pk` (VAPID contact).
- Worker: `https://dashboard.naqsha-zameen.pk`, `http://localhost:3000`, `http://localhost:5000`.

**Backend env names read** (for completeness): `MONGO_URI`/`MONGODB_URI`, `SECRET_KEY` (≥32 chars), `PORT` (5000), `NODE_ENV`, `CORS_ORIGIN`, `FRONTEND_URL`, `COOKIE_DOMAIN`, `COOKIE_SAMESITE`, `REDIS_ENABLED`, `REDIS_URL`, `PMTILES_SIGNING_KEY`, `CLOUDFLARE_WORKER_URL`/`REACT_APP_CLOUDFLARE_WORKER_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SMTP_HOST/PORT/USER/PASS`, `FROM_NAME`, `FROM_EMAIL`, `ADMIN_REPORT_EMAIL`, `TURNSTILE_SECRET_KEY`, `ENABLE_TURNSTILE`, `PAYMENT_PROOF_DIR`, `DEMO_LINK_BASE_URL`, `LOG_LEVEL`, `AKAR_TEHSILS`. No `backend/.env` or `.env.example` is present in this checkout.

---

## 7. Realtime / notification UI contract

- **Model** `backend/models/Notification.js`: `userId, type('subscription'|'profile'|'alert'|'info'|'activation'), title, message, read, action:{label,url,kind:'renewal'|'assignment',ref}, actionDone, replyTo (customer userId), lastReply:{at,message}, details (Mixed), createdAt`.
- **Wire shape** (REST and socket identical): `{ id, type, title, message, timestamp, read, action?, replyTo?, details?, actionDone }`. REST returns newest-first, max 60.
- **Delivery**: AuthContext merges socket pushes (dedupe by `id`) with a 12 s poll + focus/visibility refetch (needed because pm2 cluster + possible missing Redis adapter). Poll replaces state only when ids or `actionDone` flags changed. Local OS banner via `reg.showNotification` / `new Notification` only when `!window.__pushEnabled`.
- **Refresh trigger**: `type ∈ {subscription, activation, profile}` or title contains "subscription" → `fetchUserProfile()` + `realtimeNotification` modal.
- **Actions**: `action.url` is an in-app path (`/admin/activate/<token>`), rendered as a button; `actionDone` hides it once the request is decided.
- **Reply flow** (admin / sub-admin, `App/ReplyModal.js`): `GET /api/notifications/:id/reply-info` → `{customer:{userId,userName,plan,daysLeft,mouzaCount,lastFeePaid,endDate,mobileNumber,…}, provider, signOff, details}` for templates; `POST /api/notifications/:id/reply {message}` → customer receives `type:'info', title:'Message from <name>'` notification (socket + push), original marked read with `lastReply`; sub-admin replies are mirrored to admins.
- **Read / clear**: `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`, `DELETE /api/notifications`. Unread count = `notifications.filter(!read).length` (header badge).
- Admin-facing notifications originate from `notifyAdmins` (activation, provider reports, sub-admin login-as, etc.).

---

## 8. Version checker & build

- `generate-build-version.js` (`prebuild`): bumps `package.json.version` (patch, carrying at >9), writes `{version, buildDate:<epoch ms>}` to **both** `public/meta.json` (deployed, fetched at runtime) and `src/meta.json` (imported into the bundle). Current: `4.1.4 / 1792294619681`.
- `C/Common/VersionChecker.js` (wraps `<App/>` in `index.js`): on mount unregisters every SW except `/push-sw.js`; `fetch('/meta.json?t=<now>', {cache:'no-cache'})` (relative → SPA host) now and every 30 min; if `server.buildDate > bundled.buildDate` and `localStorage.latestVersionAttempted !== buildDate` → set it, delete all CacheStorage, `window.location.reload(true)`. Never clears storage/cookies.
- Vite equivalent: keep writing `public/meta.json` and import the same JSON (or inject via `define`); keep path `/meta.json` at the SPA origin.
- `deploy.sh` details in §6B (`BUILD_PATH=build_next`, `GENERATE_SOURCEMAP=false`, pm2 reload). `build_verify.log`, `build_next/`, `build_prev/` are transient.

---

## 9. Dead code / cruft

**`src/` files not imported by any other `src/` file** (static relative-import graph; `index.js` is the entry):
`DemoAccess.js` (root; byte-identical to `components/Admin/DemoAccess.js`), `ResetPassword.js` (root; older variant posting to non-existent `/api/auth/reset-password`), `reportWebVitals.js`, `config/pmtiles-simple.js`, `utils/formControlFixes.js`, `components/Auth/ChangePasswordForm.js`, `components/Common/{Breadcrumb,FloatingActionButton,SearchableDropdown,SkeletonLoader,ToastContainer,TutorialWidget}.js`, `components/Map/Core/Map/GeoJsonInteractionLayer.js`, `components/Map/Core/{MapSidebar,ShapeTransformControls,VectorTileToggle}.js`, `components/Map/{MapControlsPanel,MapLegend}.js`, `components/User/EditProfileForm.js`, `components/User/UserManagement/{BulkOperations,UserActions,UserDetails}.js` (UserDetails calls non-existent `/user-sessions/:id`).
Other dead bits inside live files: `App/Modals/EmailSetupModal.js` posts to `/users/:id/email` (no such route; feature disabled via `needsEmail=false`); `lib/mouzaApi.js` `fetchTehsilsFromMetadataFolder/fetchTehsilsFromMetadataHost` (PHP + 13-tehsil HEAD probe) only run when <100 tehsils were found; `config/pmtiles.js getPMTilesUrl` deprecated shim; `App/Modals.js` is a one-line re-export of `App/Modals/index.js`; `src/services/` is an empty directory; `src/styles/GoToLocationForm.css.bak`.

**Repo-level cruft**: `cookies.txt` (curl cookie jar with a live `x-csrf-token` cookie for `.naqsha-zameen.pk`), `build_verify.log`, `scratch/` (`check_db_sessions.js`, `login_test.json`, `test_login.js`, `trav.js` — one-off scripts), root `config` (a 140-byte CLI telemetry JSON `{"userId":…,"telemetryAnonymousId":…,"enableTelemetry":true,…}` — not project config; `.gitignore` lists `/config`), `public/static/**` (23 files) + `public/asset-manifest.json` (stale build output; gitignored now), `public/manifest.json` references `favicon.ico`/`logo192.ico`/`logo512.ico` that do not exist (actual files are `.png`/`.svg`), `public/get_mauza_list.php`, `public/list-metadata-folders.php` (see §6), `cloudflare-worker/pmtiles-worker.js` (HMAC worker not deployed by `wrangler.toml`), `cloudflare-worker/zip-extractor-worker.js`, `cloudflare-worker/test-download.pmtiles` (0 bytes), `cloudflare-worker/cloudflare-worker/test-r2-download.pmtiles`, `cloudflare-worker/.wrangler/`, `cloudflare-worker/node_modules/`, `backend/scripts/*` (migrations / one-off imports), `backend/assets/GeoMatrix Logo.png` + `backend/templates/dailyReportTemplate.js` (used by report PDF — keep).
Frontend `package.json`: `@testing-library/*`, `web-vitals`, `react-scripts` go away with Vite; `zustand`, `konva`/`react-konva` (Aks Shajra tool), `html2canvas`, `jspdf`, `leaflet-simple-map-screenshoter` are used by specific features — verify per feature. `"server": "node backend/server.js"` script duplicates backend's own.

---

## 10. Backend ↔ frontend build coupling

- No backend node module exists only to support the frontend build. `backend/package.json` lists `csrf-csrf` (unused — custom CSRF replaced it), `redis` (unused alongside `ioredis`), `node-cache`, `uuid` (server.js uses `crypto.randomUUID`), `puppeteer`/`@napi-rs/canvas`/`chart.js` (report PDF rendering) — backend concerns only.
- Backend references to `REACT_APP_*`: only `middleware/signedPMTilesUrl.js:5` (`CLOUDFLARE_WORKER_URL || REACT_APP_CLOUDFLARE_WORKER_URL`) and a comment in `services/providerService.js:12`. Ensure the backend `.env` defines `CLOUDFLARE_WORKER_URL` so the Vite rename does not break signing.
- Backend serves the SPA only if `../build` exists (`BUILD_ROOT`), so a Vite `outDir: 'build'` keeps `deploy.sh` and the catch-all working unchanged; `index.html` must stay at `build/index.html`, `meta.json` and `push-sw.js` at the build root.
- helmet CSP applies to pages served by the backend: `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: https:`, `connect-src 'self' <CORS_ORIGIN> http://localhost:5000 ws://localhost:5000` (the Worker origin is **not** listed — PMTiles/map tile fetches would be blocked by CSP if the SPA were served by the backend; another sign topology A is live), `frame-ancestors 'none'`. A Vite build served from the same host must not need external script/style origins (Google Fonts etc. would be blocked).
