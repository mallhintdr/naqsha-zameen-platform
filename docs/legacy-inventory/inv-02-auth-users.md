# INV-02 — Authentication screens & User management (legacy CRA + react-bootstrap)

Source root: `D:\temp-repo\old-repo\src`. API base = `process.env.REACT_APP_API_URL` (`https://api.naqsha-zameen.pk` in `.env`). All axios calls use `withCredentials: true` (cookie auth; `axios.defaults.withCredentials = true` is set in AuthContext and UserEditForm). Icons: Font Awesome 6 free (`fas fa-*` classes, loaded globally) and `react-icons/fa`.

---

## 0. File inventory — live vs dead

| File | Status | Notes |
|---|---|---|
| `components/Auth/Login.js` | LIVE, route `/login` | |
| `components/Auth/PublicUserRegistration.js` | LIVE, route `/register` | uses RegistrationGuidanceModal, RegistrationSuccessModal |
| `components/Auth/UserRegistration.js` | LIVE, route `/admin/register` (admin) | uses RegistrationSuccessModal(isAdminRegistered) |
| `components/Auth/ResetPassword.js` | LIVE, route `/reset-password?token=` | |
| `components/Auth/VerifyEmail.js` | LIVE, route `/verify-email?token=` | |
| `components/Auth/ChangePasswordForm.js` | **DEAD** — never imported anywhere; imports `./styles/global.css` etc. which do not exist (would fail to compile if imported). App.js keeps `showChangePassword` state and ProfileModal's "Change Password" button sets it, but **no component consumes it** → the button does nothing visible. |
| `components/Auth/RegistrationGuidanceModal.js` / `RegistrationSuccessModal.js` | LIVE | |
| `src/ResetPassword.js` (root) | **DEAD duplicate** — older version (posts to `/api/auth/reset-password`, plain card, no logout-on-open, redirects after 2.5 s). App.js lazy-loads `./components/Auth/ResetPassword`. |
| `src/DemoAccess.js` (root) | **DEAD duplicate** — App.js lazy-loads `./components/Admin/DemoAccess`. Root file: redirects to `${API}/demo-access/:token` via `window.location.replace`, renders "Preparing demo access…". |
| `components/User/UserList.js` | LIVE, route `/users` (admin) | |
| `components/User/UserEditForm.js` + `UserEditSections/*` + `CustomDatePicker.js` | LIVE (modal opened from UserList; also from Admin SubAdminUsers) | |
| `components/User/UserDetail.js` + `UserDetailTabs/*` | LIVE, route `/users/:userId` (self or admin) | ProfileTab/SubscriptionTab/AccessControlTab have an `editMode` branch that is never used (always `editMode={false}`) |
| `components/User/ChangeMouzasModal.js` | LIVE — opened from `App/Modals/ProfileModal.js` and `App/NavigationMenu.js` (customer side) | |
| `components/User/EditProfileForm.js` | **DEAD** — not imported anywhere (only place `react-input-mask` is used: mask `"399 9999999"`, maskChar `" "`). |
| `components/User/UserManagement/{BulkOperations,UserActions,UserDetails}.js` | **DEAD** — not imported anywhere. Documented briefly in §14 for completeness. |
| `styles/userlist.css`, `action-buttons.css`, `subscription-buttons.css`, `profile.css`, `form.css`, `modal.css`, `tokens.css`, `global.css` | LIVE | `userlist.css` also imported by Admin pages |
| `styles/user-management.css`, `table.css`, `tempAccess.css` | **DEAD** — not imported by any JS file |
| `styles/form-fixes.css` | **EMPTY (0 bytes)**, not imported |
| `UserDetailTabs/styles/tabs.css`, `responsive.css` | LIVE (imported by UserDetailTabs/index.js and UserEditForm.js) |
| `utils/userUtils.js`, `utils/formUtils.js` | LIVE | `utils/statsUtils.js` is NOT used by any of these screens (only Admin stats) |
| `icons/Easypaisa-logo.png`, `icons/JazzCash_logo.png` | used ONLY in `App/Modals/SubscriptionWarningModal.js` (§9). `icons/geomatrix.png` = navbar/profile logo (other slice). |

Related live files outside the slice folders but part of these workflows (documented here because the flows depend on them): `App/Modals/ProfileModal.js`, `App/Modals/ForgotPasswordModal.js`, `App/Modals/SubscriptionWarningModal.js`, `components/Common/PasswordResetModal.js`, `components/Common/CompactModal.js`, `components/Admin/PaymentProof.js`, `components/Admin/ActivationPages.js` (routes `/activate/:token`, `/subadmin/activate/:token`, `/confirm-email/:token`), `components/Admin/AdminActivate.js` (`/admin/activate/:token`), `context/AuthContext.js`.

---

## 1. Shared foundations

### 1.1 Routes & guards (App.js)
```
/login                      Login                      public
/register                   PublicUserRegistration     public
/admin/register             UserRegistration           ProtectedRoute requiredRole="admin"
/users                      UserList                   ProtectedRoute requiredRole="admin"
/users/:userId              UserDetail                 SelfOrAdminRoute (admin OR user.userId === :userId)
/reset-password             ResetPassword              public
/verify-email               VerifyEmail                public
/demo/:token                Admin/DemoAccess           public
/admin/activate/:token      AdminActivate              (own slice)
/activate/:token            CustomerActivatePage       public (Admin/ActivationPages)
/subadmin/activate/:token   SubAdminActivatePage       public
/confirm-email/:token       ConfirmEmailPage           public
```
- `ProtectedRoute`: while `loading` → full-page centered `<Spinner animation="border" variant="primary"/>` in a `d-flex justify-content-center align-items-center h-100` div with `minHeight:100vh`. No user → `<Navigate to="/login" replace/>`. Wrong role → `<Navigate to="/" replace/>`.
- `SelfOrAdminRoute`: same, allows `user.userType === 'admin' || user.userId === params.userId`.
- Roles: `userType` ∈ `admin | subadmin | user | demo`.
- `onAuthPage` regex in App.js: `/^\/(login|activate\/|subadmin\/activate\/|confirm-email\/)/` — subscription-warning & IP-warning modals are suppressed on those paths (NOT on /register, /reset-password, /verify-email).

### 1.2 AuthContext endpoints used by these screens
| Function | Call |
|---|---|
| `login({userId,password,otp?})` | if another user is signed in with a different userId → `switchAccount()` first. `POST /api/login` body `{userId,password,otp?, ...getDevicePayload()}` (device id + signature). If `data.needsOTP` → returns `{needsOTP:true,message}`. Else `fetchUserProfile()` (`GET /api/profile`), then `navigate('/')`. 429 → global ErrorModal `{title:'Too Many Requests', message}`; 401 → sets context error `'User ID or Password is incorrect. Please try again.'` and rethrows (Login.js shows its own alert). |
| `switchAccount()` | `POST /api/logout {clearAll:true}` then resetLocalSession (clears `sessionStorage.user`, warning, ipMisuse, notifications, socket). Stays on page. |
| `logout()` | disables push, `POST /api/logout {}`, navigate `/login`. |
| `loginAs(userId)` | `POST /api/admin/login-as/:userId`; clears `sessionStorage.user`; re-fetch profile; `navigate('/')`. On failure → ErrorModal `{title:'Login As Failed', message: data.message || data.error || 'Failed to switch to user. Please check if user is active.'}`. |
| `changePassword(old,new)` | `POST /api/change-password {userId, oldPassword, newPassword}`; clears `authToken` cookie; `logout()`. On error throws `Error('Failed to change password.')`. (Only caller = dead ChangePasswordForm.) |
| `fetchUserProfile()` | `GET /api/profile` → stores normalized user in `sessionStorage.user`, computes `warning` via `buildSubscriptionWarning` (§9), `ipMisuse`. |
| Heartbeat | `POST /api/heartbeat` every 60 s while logged in. |

### 1.3 Storage keys
| Key | Store | Writer | Purpose |
|---|---|---|---|
| `userId` | localStorage | Login.js | "Remember me" → pre-fills User ID + checks box on next visit. Removed when unchecked. |
| `password` | localStorage | Login.js **removes** it on mount and after login (legacy cleanup; never written) |
| `pending_activation_creds` | sessionStorage | PublicUserRegistration (JSON `{userId,password}`) | read by VerifyEmail to prefill login after activation (only if `parsed.userId === verifiedUserId || !verifiedUserId`). Never deleted explicitly. |
| `user` | sessionStorage | AuthContext | cached profile JSON |
| `geo_device_id` | localStorage | utils/deviceUtils `getDeviceId()` | persistent device id; survives `clearAppData()` wipe (only key preserved). Sent in `/api/register` payload and login payload. |
| `geo_known_mouzas_${userId}_${tehsil}` | localStorage | UserEditForm | JSON array of every mouza ever seen assigned for that user+tehsil; merged into the Access tab option list so de-assigned mouzas still show as unchecked options. |
| `admin_map_mode` | localStorage | App.js (not this slice) | |

Cookies cleared client-side by ResetPassword on open: `authToken`, `adminAuthToken`, `x-csrf-token` (path `/`, bare host, host, and `.parent.domain`). `changePassword` clears `authToken`.

### 1.4 Design tokens (`styles/tokens.css`, loaded in App.js)
```
--brand-primary #0096c7; --brand-primary-hover #0077a3; --brand-primary-light rgba(0,150,199,.12); --brand-accent #00ffff
--dark-bg-start rgba(11,14,40,.95); --dark-bg-end rgba(18,26,54,.98)
--dark-bg-radial: radial-gradient(circle at 20% 20%, rgba(45,152,255,.35), transparent 60%), linear-gradient(135deg, var(--dark-bg-start), var(--dark-bg-end))
--dark-accent-border rgba(0,255,255,.3)
--color-success #10b981 (hover #059669, light rgba(16,185,129,.12)); --color-danger #ef4444 (#dc2626); --color-warning #f59e0b (#d97706); --color-info #06b6d4 (#0891b2)
--status-active-bg rgba(16,185,129,.12) / border #10b981
--status-expiring-bg rgba(245,158,11,.12) / border #f59e0b
--status-expired-bg rgba(239,68,68,.12) / border #ef4444
--status-pending-bg rgba(255,193,7,.15) / border #ffc107
--color-text-primary #1f2937; secondary #6c757d; muted #9ca3af; inverted #fff
--color-bg-body #fff; muted #f8f9fa; subtle #f1f5f9; --color-border #e9ecef
--font-family 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
--text-xs .75rem; sm .875rem; base .9375rem; md 1rem; lg 1.125rem; xl 1.25rem
--radius-sm 4px; md 6px; lg 8px; xl 12px; 2xl 16px
--shadow-xs 0 1px 2px rgba(0,0,0,.05); sm 0 2px 4px .07; md 0 4px 12px .10; lg 0 8px 24px .14; xl 0 12px 40px .18
--input-border-color #6c757d; --input-border-radius 6px; --input-bg #fdfdfd; --input-focus-border #0096c7; --input-focus-shadow 0 0 0 3px rgba(0,150,199,.2); padding .5rem .75rem; font 1rem
--table-header-bg linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%); --table-header-color #e4e7eb; accent #00ffff
--card-header-bg var(--dark-bg-radial); --card-header-color #00ffff
--modal-header-bg var(--dark-bg-radial); --modal-header-text #f8fbff
```

### 1.5 `form.css` global overrides (imported by PublicUserRegistration, UserRegistration, UserEditForm — but CRA bundles globally so it applies app-wide once loaded)
- `.form-control, .form-select, textarea`: border `1px solid #6c757d`, radius 6px, bg `#fdfdfd`, color `#1f2937 !important`, font 1rem, padding .5rem .75rem. Focus: border `#0096c7`, shadow `0 0 0 3px rgba(0,150,199,.2)`, bg #fff. Disabled: bg `#f8f9fa`, text color kept `#1f2937`, opacity 1.
- `.dark-gray-borders .form-control/.form-select/textarea`: border `1px solid #495057 !important` (used by UserEditForm Subscription/Access/Multi-use sections).
- Labels: color `#1f2937 !important`, weight 500.
- `.card` (global!): bg #fff !important, border `1px solid rgba(0,255,255,.3)`, radius 8px, shadow `0 2px 4px rgba(0,0,0,.07), 0 0 15px rgba(0,255,255,.08)`.
- `.card-header` (global!): background = dark radial gradient (`--card-header-bg`), color `#00ffff`, border-bottom `1px solid rgba(0,255,255,.3)`, weight 600, padding `.6rem 1rem`, plus `::after` 1px line `linear-gradient(90deg, transparent 0%, rgba(0,255,255,.6) 50%, transparent 100%)`. **This means every react-bootstrap `Card.Header` without an inline background (PublicUserRegistration, UserDetail tabs, ProfileTab etc.) renders as the dark navy gradient with cyan text.** UserRegistration overrides inline (#1e293b / #0f766e / #b45309).
- `.btn, button`: inline-flex centered, radius 6px, padding `.4375rem .875rem`, weight 600, font .875rem, border 1px transparent, transition 250ms. `.btn-sm`: `.25rem .625rem`, .75rem. `.btn-lg`: `.625rem 1.25rem`, 1.125rem. Focus ring `0 0 0 3px rgba(0,150,199,.3)`.
- `.btn-primary` bg/border `#0096c7`, hover `#0077a3` + shadow `0 4px 12px rgba(0,150,199,.35)` + `translateY(-1px)`. `.btn-secondary` #6c757d (hover #5a6268/#545b62). `.btn-success` #10b981 (hover #059669, shadow rgba(16,185,129,.35)). `.btn-danger` #ef4444 (hover #dc2626). `.btn-warning` #f59e0b, text #1f2937. `.btn-info` #06b6d4. `.btn-dark` #212529 (hover #16191c). Outline variants: transparent bg, border+text in the semantic color, hover bg = the `-light` rgba. `.btn-outline-secondary` border/text #6c757d, hover bg rgba(108,117,125,.1) text #495057.
- **Note:** `.btn-primary` is therefore `#0096c7` (cyan-blue), NOT Bootstrap's `#0d6efd`, everywhere in the app, except where inline styles override.
- `@media (max-width:768px) .registration-form-container`: padding-x 0, cards square/no side borders/no shadow, card-body padding 15px, h3 1.5rem with 15px side padding, `.row` margins 0, `.col-md-4/.col-md-6` padding 0, each `.row > .col-md-4` width 100% with no side borders and `padding:10px 0`. `.registration-buttons-row` → `justify-content:center`, padding 0 15px, each `.reg-btn` flex 1, max-width 200px. Desktop: `.registration-buttons-row {justify-content:flex-end}`.

### 1.6 `modal.css` (relevant variants)
- `.modal-dialog`: flex-centered, `margin:auto !important`, padding 0, `min-height: calc(100% - 1rem)`.
- `.modal-content`: shadow `0 15px 35px rgba(0,0,0,.4), 0 0 20px rgba(0,255,255,.1)`, border `1px solid rgba(255,255,255,.1)`.
- `.unified-modal`: content radius 12px, shadow `0 10px 40px rgba(0,0,0,.4)`, white bg; header bg `radial-gradient(circle at 20% 20%, rgba(45,152,255,.35), transparent 60%), linear-gradient(135deg, rgba(11,14,40,.95), rgba(18,26,54,.98))`, padding `6px 16px !important`, color `#f8fbff`, title 1rem 600 letter-spacing .5px; btn-close inverted white opacity .8; body padding 20px, .95rem, color `#2c5364`; footer `12px 16px`, border-top #e5e7eb, bg #f9fafb, gap 8px.
- `.modern-modal-compact`: dialog `max-width:315px !important`, width 100%; content radius 10px, shadow `0 10px 30px rgba(0,0,0,.35)`; header same gradient, padding `10px 14px !important`, title `.85rem !important` 600; btn-close .75rem; body `14px 16px`, .9rem; footer `10px 14px`, bg #f9fafb.
- `.subscription-warning-dialog`: max-width 300px; header `5px 10px`, title .82rem, body `8px 10px`, footer `6px 10px` (all !important).
- `.user-edit-modal`: dialog `max-width:580px !important`, `min-height: calc(100% - 3.5rem)`; content `max-height:90vh`, flex column; body overflow-y auto, padding 0; `.tab-content-wrapper {padding:10px 16px !important}`; `.form-group {margin-bottom:.5rem !important}`.
- `.compact-fit-modal` (CompactModal): keeps modal inside viewport (scrollable body).

### 1.7 Shared helpers
- **`formatPhoneNumber(value)`** (identical copies in PublicUserRegistration, UserRegistration, utils/formUtils): strips non-digits; strips leading `0092` / `92` / `0`; keeps max 10 digits; returns `'+92 '` when empty, `'+92 ' + d` for ≤3 digits, else `'+92 ' + d[0..3] + ' ' + d[3..]`. Result e.g. `+92 300 1234567`. The user literally types into a text input and the value is re-formatted on every keystroke.
- **`subscriptionOptions`** (utils/userUtils, hard-coded): `Trial 2d, Weekly 7d, Monthly 30d, Quarterly 90d, Half-Yearly 180d, Yearly 365d, Permanent -1`.
- **Date math (GMT+5)**: `calculateEndDate(start,type)` = start shifted to GMT+5 + days (Permanent → `2099-12-31`). `calculateDaysRemaining` → `99999` for Permanent else `max(ceil((end-today)/day),0)` with both zeroed to midnight GMT+5. `calculateStatus(end,type)` → `'Active'` if Permanent or end ≥ today else `'Expired'`. `getCurrentDate()` → GMT+5 `YYYY-MM-DD`.
- **`formatEndDateToDMY('YYYY-MM-DD')`** → `DD-MM-YYYY` (passes through strings containing "permanent").
- `normalizeMauzas` (formUtils): trim, drop empties, drop names containing `-complete` (case-insens.), unique, `localeCompare` sort. (UserList's local copy does NOT drop `-complete` and does not sort.)
- `withoutAkar(list)` (utils/akar): removes AKAR tehsils — public registration & sub-admins never see them.
- Tehsil list source: `lib/mouzaApi.fetchConsolidatedTehsils()` returns array of `{name, isGroup, rawAliases[]}` (or strings); `fetchMauzas(tehsil)` returns string[]. UserList uses `fetchTehsils()` (plain names).

---

## 2. Login — `/login` (`components/Auth/Login.js`)

**Access**: public. Reached via direct URL, `<Navigate>` from guards, `logout()`, registration/reset/verify redirects, quick-login links `/login?t=<base64 JSON {u,p}>`, `/login?redirect=/path`.

**Entry logic**
1. `redirectTo` = `?redirect` if it starts with `/` and not `//`, else `/`.
2. `targetUserId` = `JSON.parse(atob(?t)).u` or `location.state.prefill.userId` or `location.state.userId`.
3. If a user is already signed in AND `targetUserId` set: same id (case-insens.) → `navigate(redirectTo,{replace:true})`; different → show info alert "Signing out {userName} so you can log in as {targetUserId}…" (with sm spinner) and call `switchAccount()`; submit disabled meanwhile.
4. `?t` token with `u` and `p` → prefill userId+password, rememberMe false.
5. `location.state.prefill {userId,password}` → prefill both; message: `activationSuccess` ? success `"Account activated successfully! Click Login to enter your dashboard."` : info `"Registration successful! Please login to continue."`.
6. else `location.state.userId` → prefill id only; message: `activationSuccess` ? success `"Account activated successfully! Please enter your password to log in."` : success `"Password reset successful. Please login with your new password."`.
7. If `state.userId || state.focusPassword` → focus password input after 150 ms.
8. Else if `localStorage.userId` → prefill + rememberMe=true. Always `localStorage.removeItem('password')`.

**Layout**: full-viewport flex-centered wrapper, bg `#f4f6f9`, padding 20px. `Container` maxWidth 400px. Card: no border, radius 12px, shadow `0 4px 24px rgba(0,0,0,.05)`, bg #fff, overflow hidden; body padding `40px 30px`. Header centered: 60×60 circle bg `#e9ecef` containing emoji `🔐` (font 1.5rem), margin `0 auto 15px`; `h3` "Welcome Back" 1.5rem 700 `#212529`; `p` "Sign in to your account" `#6c757d` .9rem margin-top 8px. Alerts: radius 8px, .9rem, padding `10px 15px`, mb 20px.

**Fields** (labels .9rem 500 `#495057`; inputs height 42px, radius 8px, .95rem, left icon absolute `left:12px top:12px` color `#adb5bd`, `paddingLeft:35px`):
| Field | name | type | placeholder | validation |
|---|---|---|---|---|
| User ID | `userId` | text, `FaUser` icon | `Enter User ID` | HTML `required` |
| Password | `password` | password/text toggle, `FaLock` icon; eye toggle `FaEye/FaEyeSlash` absolute right 12px top 12px color `#6c757d`, paddingRight 40px | `Enter Password` | `required` |
| Verification Code (OTP) — only when `needsOTP` | `otp` | text, maxLength 6, `fas fa-key` icon `#198754`; label 700 `#198754`; input 1.1rem bold, letter-spacing 5px, border `1px solid #198754`, centered; group has `animate__animated animate__fadeIn`; helper `<small class="text-muted mt-1 d-block text-center">Check your email for the verification code.</small>` | `Enter 6-digit OTP` | `required` |
| Remember me | checkbox `rememberMe`, .9rem `#495057` | | | |

Row below password: `Form.Group mb-4 d-flex justify-content-between` with checkbox left and link-button **"Forgot Password?"** right (variant link, .85rem, padding 0, `#0d6efd`, no underline, 500; shows `"Sending..."` while `resetLoading`; disabled meanwhile).

**Buttons**
- **Login** — `type=submit`, variant primary (CSS → `#0096c7`), width 100%, padding 10px, radius 8px, 600, 1rem, height 45px. Disabled when `loading || submitting || switching`. Loading content: sm spinner + `"Logging in..."`.
  - Calls `login()` (§1.2). Success → `localStorage.userId` set/removed per rememberMe, `localStorage.removeItem('password')`, message success `"Login successful!"`, `navigate(redirectTo)`.
  - `needsOTP` → `setNeedsOTP(true)`, open OTP modal, stop.
  - Errors (Alert danger): 400 && needsOTP → `data.message || 'Invalid verification code.'`; 401 → `data.message || 'Invalid User ID or Password. Please try again.'`; else (not in OTP flow) → `data.message || error.message || 'Login failed. Please check your network and credentials.'`. 429 handled by AuthContext global ErrorModal.
- **Forgot Password?** — if `userId` empty → danger `"Please enter your User ID first."`. Else `POST /api/forgot-password {userId}` → info: `data.email ? "A reset link has been sent to your registered email: {email}" : data.message`; error danger `data.message || 'Failed to send reset link. Please try again.'`.

**Footer**: mt 20px centered .9rem: `Don't have an account? ` (#6c757d) + `Link to="/register"` "Sign Up" (`#0d6efd`, 600). Then mt 15px .85rem: `Help & Support: ` + `<a href="tel:03048840264">0304-8840264</a>` (`#0d6efd`, 500).

**OTP Sent modal** (hand-rolled Bootstrap markup, always in DOM, toggled with `show d-block`, backdrop `rgba(0,0,0,0.5)`): `modal-dialog-centered modal-sm`; content border-0 shadow radius 15px; header `bg-success text-white border-0` radius `15px 15px 0 0`, title 1rem `fas fa-paper-plane` "OTP Sent", white btn-close; body centered py-4: icon `fas fa-envelope-open-text` 2.5rem `#198754` mb-3; text .9rem `#495057` "A verification code has been sent to your registered email address."; footer border-0 with full-width `variant="success"` "OK" radius 8px.

Responsive: single column at all widths (container 400px max; 20px wrapper padding).

---

## 3. Public registration — `/register` (`components/Auth/PublicUserRegistration.js`)

**Access**: public (no guard). Linked from Login footer and VerifyEmail "Register Again".

**Page**: `Container className="py-2" maxWidth 1000px`. Title block centered mb-2: `h3.fw-bold` "Create Account" color `#0b0e28`, 1.4rem, margin `5px 0`; `p.text-muted.small` "Join GeoMatrix to access advanced mapping tools". Three `Card mb-3` sections with `Card.Header py-2` containing `h6.mb-0.fw-bold` .9rem (header styled by global `.card-header` = dark gradient + cyan text) and `Card.Body p-2 px-3`.

**Defaults**: `{userName:'',userId:'',password:'',confirmPassword:'',mobileNumber:'',email:'',subscriptionType:'Trial'}`; name input auto-focused on mount. Tehsil list = `withoutAkar(fetchConsolidatedTehsils())`.

### Card 1 "Basic Information" (2 cols `md=6`, groups `mb-2`, labels `fw-semibold small mb-1`)
| Label | name | type | placeholder | notes |
|---|---|---|---|---|
| Full Name * | userName | text | `Enter your full name` | required |
| Email Address * | email | email | `example@mail.com` | hint `.72rem text-muted`: `fas fa-envelope-open-text text-primary` "Activation link will be sent to this email." |
| Mobile Number * | mobileNumber | text (auto-format §1.7) | `+92 300 1234567` | |
| User ID * | userId | text | `Choose a unique ID` | label row has right-aligned **"Suggest ID"** button (`variant=dark size=sm`, .7rem, bg `#1a1a1a`, no border, px-2 py-0). Debounced 500 ms `GET /api/public/check-userid/:userId` → `data.exists` ⇒ red `.text-danger` small "This User ID is already taken. Please choose another one."; while checking: sm spinner 12px + "Checking availability..."; available & non-empty: `.text-success` "✓ User ID is available". |
| Subscription Plan | subscriptionType | select | — | options filtered to `['Trial']` only (shows "Trial"); hint `fas fa-info-circle text-info` "Free trial plan with access to 1 Tehsil & 1 Mouza." |

`suggestUserId()`: `userName.toLowerCase().replace(/\s+/g,'.') + '_' + (last 4 digits of mobile || random 100–999)`.

### Card 2 "Area of Interest" (3 columns `md=4`; col1 & col2 have `borderRight:1px solid #f0f0f0`)
- **Col 1 "Available Tehsils"** (h5 .85rem 600 `#495057` mb 8px): `Form.Control size=sm placeholder="Search Tehsil..." mb-2`; list box height 350px, overflow-y auto, border `1px solid #dee2e6`, radius 5px, padding 5px, bg #fff. Items: padding `8px 10px`, .85rem, radius 4px, border-bottom `1px solid #f8f9fa`, mb 3px; selected bg `#e3f2fd`; group bg `#f0f9ff` + borderLeft `4px solid #0284c7` + `🔗` prefix + bold `text-primary-emphasis` + `Badge bg=info text=dark` "Merged" (.62rem, `2px 5px`), title tooltip `Merged Group (aliases)`; selected shows `fas fa-check text-success` on right. Empty: "No tehsils found".
- **Col 2 "Select Mouzas"** + `Badge bg=primary pill .7rem` "{n} selected" when tehsil chosen. No tehsil → placeholder box height 350px bg `#f8f9fa` radius 8px border `1px dashed #dee2e6` color #6c757d with `fas fa-mouse-pointer` 1.5rem opacity .5 and "Select a tehsil first". Else `Search Mouza...` sm input (ref focused after each toggle) and list box (same style as col1, 350px): rows padding `6px 10px`, .85rem, flex gap 8px, checkbox (`pointer-events:none`) + truncated name; selected bg `#d4edda`.
  - **Limit**: total mouzas across all tehsils ≤ 1. Exceeding → `setMessage` danger `"Selection limit reached: Public accounts can access a maximum of 1 mouza."` (shown in the small notification modal below). First selection sets `activeTehsil`.
- **Col 3 "Assigned Summary"**: small `.75rem`: `Selected: <strong>{t}/1</strong> Tehsil · <strong>{m}/1</strong> Mouza`. Empty: box 250px dashed with `fas fa-list-check` "No areas assigned yet". Else scroll box maxHeight 250px: per tehsil `Card mb-2 shadow-sm border-0` bg `#f0fff4` if primary else `#fff`, border `1px solid #c6f6d5` / `#edf2f7`; body p-2: tehsil name strong .85rem truncated + `Badge bg=success .6rem` "Primary"; clickable `Badge bg=secondary .65rem` "{n} mouzas" + caret `fas fa-caret-up/down` toggles expansion; right buttons (link, p-0, icons 1.1rem): `fas fa-edit text-primary` (select tehsil), `fas fa-star text-success` "Make Primary" (hidden if primary), `fas fa-trash-alt text-danger` "Remove". Expanded list: `mt-2 pt-2 border-top` max 200px; rows `.75rem` bg `#f8f9fa` borderLeft `3px solid #6c757d` with `{idx}.` muted and name `fw-medium text-dark`.

### Card 3 "Security" (2 cols)
| Label | name | placeholder | notes |
|---|---|---|---|
| Password * | password | `Min 6 characters` | eye toggle `variant=link` absolute `end-0 top-0 h-100 px-3 text-muted` (`fas fa-eye/fa-eye-slash`), zIndex 5; hint `.72rem`: "Password must be at least 6 characters long and include at least one uppercase letter, one lowercase letter, and one special character." |
| Confirm Password * | confirmPassword | `Repeat password` | shares `showPassword` toggle |

### Turnstile
`const ENABLE_TURNSTILE = false; // Temporary bypass` — the block is compiled but never rendered. When enabled: box `d-flex flex-column align-items-center mb-3 p-2 bg-light rounded shadow-sm border` .8rem; label "Security Check *"; `<Turnstile siteKey={REACT_APP_TURNSTILE_SITE_KEY} options={{theme:'light',size:'normal'}}>`; onSuccess sets token, onError → danger alert `fas fa-clock` "**Verification Failed:** Please ensure your device's date and time are set correctly. Incorrect time settings can cause Cloudflare security to fail."; missing site key → warning "Turnstile Site Key missing in .env". Gate only in `NODE_ENV==='production'`: submit click without token → message danger "Please complete the CAPTCHA verification."; submit handler → GENERIC guidance "Security Verification Required" / "Please complete the Cloudflare security verification before registering." / ["Check the security checkbox below the form."]. Submit button opacity .7 + cursor not-allowed while gated. `captchaToken` is still sent (empty string) in the payload.

### Submit button
`variant=primary type=submit w-100 py-3 fw-bold shadow-sm mt-2`, text "Create Account" (sm spinner prefix while loading), style: `background: radial-gradient(circle at 20% 20%, rgba(45,152,255,0.45), transparent 60%), linear-gradient(135deg, rgba(11,14,40,1), rgba(18,26,54,1))`, border `1px solid rgba(0,255,255,0.4)`, radius 10px, 1.1rem. Below: `.text-center.mt-4` "Already have an account? " + Link `/login` "Login here" bold, color `#1c2a4a`.

### Validation order on submit (each failure opens RegistrationGuidanceModal, §3.1)
1. Missing fields (any of Full Name, User ID, Email Address, Mobile Number (empty or `'+92'`), Password, Confirm Password, "Tehsil & Mouza (select at least 1 mouza)") → `MISSING_FIELDS`, title "Missing Required Information", message "Please fill in all mandatory fields before submitting your registration.", details `"{field} is required"` each, focus first missing (`tehsil` focuses the tehsil search input ref — note `tehsilInputRef` is declared but never attached, so nothing focuses).
2. `userId.trim().length < 3` → `USERID_INVALID` "User ID Too Short" / "Your User ID must be at least 3 characters long." / ['Enter a longer username or click "Suggest ID" to automatically generate one.'].
3. `!/^[a-zA-Z0-9._-]+$/` → `USERID_INVALID` "Invalid User ID Format" / `The User ID "{id}" contains spaces or unsupported symbols.` / 3 bullets (letters/numbers/dots/underscores/dashes only; spaces not allowed; click "Generate Suggested User ID").
4. live `userIdError` set → `USERID_EXISTS` "User ID Already Taken" / `The User ID "{id}" is already in use by another account.` / 2 bullets.
5. password ≠ confirm → clears confirm, `PASSWORD_MISMATCH` "Passwords Do Not Match" / "The password and confirm password you entered do not match." / ['Please re-enter your confirm password carefully.','Tip: Click the eye icon to verify what you entered in both fields.'], focus confirmPassword.
6. complexity: ≥6 chars, `[A-Z]`, `[a-z]`, special `[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]` → `PASSWORD_INVALID` "Password Security Requirements" / "Your chosen password does not meet the minimum security standards." / `Required: At least 6 characters in length` / `...one uppercase letter (A-Z)` / `...one lowercase letter (a-z)` / `...one special character (!@#$%^&*...)`.
7. no assignments → `MOUZA_REQUIRED` "Tehsil & Mouza Required" / "Please select 1 Tehsil and 1 Mouza to activate your trial account." / 2 bullets.

**Request**: `POST /api/register` body `{...formData (userName,userId,password,confirmPassword,mobileNumber,email,subscriptionType), userId: trimmed, captchaToken, userType:'user', tehsilAccess:[{tehsil,mouzas[]}], activeTehsil, startDate: today ISO 'YYYY-MM-DD' (local, not GMT+5), deviceId: getDeviceId()}`.

**Success**: write `sessionStorage.pending_activation_creds`; show RegistrationSuccessModal (§3.2) with `{userName,userId,password,email,subscriptionType,tehsilAccess,activeTehsil}`; reset the form (note reset object also adds `startDate:''`, `userType:'user'`). Modal OK/close → `navigate('/login',{state:{prefill:{userId,password}},replace:true})`.

**Failure** (`data.code` or message sniffing; `errMsg = data.error || data.errors[0].msg || data.message || 'Registration failed. Please try again.'`):
- `DEVICE_EXISTS` or msg contains "device" → "Device Registration Limit Reached" / "A trial account has already been registered on this device." / 3 bullets (1 trial per device; click "Go to Login Page"; renewal request).
- `EMAIL_EXISTS` or "email" → `An account is already registered with "{email}".` / 3 bullets, focus email.
- `USERID_EXISTS` or "user id" → as #4 with slightly different bullets.
- "disposable" → `DISPOSABLE_EMAIL` "Permanent Email Required" / "Temporary or disposable email addresses are not allowed." / 2 bullets, focus email.
- else `GENERIC` "Registration Notice" / errMsg / ['Please review the information you entered and try again.'].

**Notification modal** (for `message` state — only the mouza-limit error uses it): `Modal centered size=sm dialogClassName="modern-modal-compact"`, header `py-2 px-3 border-0` title 1rem bold: danger → `fas fa-exclamation-triangle text-danger` "Error" else `fas fa-info-circle text-primary` "Notification"; body centered text .9rem (`text-danger fw-bold` / `text-success fw-bold`); footer centered sm button (danger / primary) "Close" px-4.

**Responsive**: Bootstrap `md` breakpoint (≥768px) → 2/3 columns; below → stacked. (The `registration-form-container` mobile rules in form.css apply only to the admin form.)

### 3.1 RegistrationGuidanceModal
`Modal centered backdrop=static size=sm dialogClassName="modern-modal-compact"`. Theme by `type`:
- `DEVICE_EXISTS|EMAIL_EXISTS|USERID_EXISTS|DISPOSABLE_EMAIL`: icon `fas fa-exclamation-circle`, header `linear-gradient(135deg,#c0392b 0%,#8e44ad 100%)`, border `#e74c3c`, accent `#c0392b`.
- `PASSWORD_MISMATCH|PASSWORD_INVALID|USERID_INVALID|MISSING_FIELDS|MOUZA_REQUIRED`: `fas fa-exclamation-triangle`, `linear-gradient(135deg,#d35400 0%,#f39c12 100%)`, border `#e67e22`, accent `#d35400`.
- default: `fas fa-info-circle`, `linear-gradient(135deg,#16a085 0%,#2980b9 100%)`, border/accent `#2980b9`.
Header: closeButton white, bg = theme gradient, no border-bottom, padding `8px 14px`; title .92rem 700 flex gap 8px with icon 1.05rem. Body padding 14px bg `#fcfcfd`: message card (bg #fff, radius 8px, borderLeft `4px solid {borderColor}`, padding `10px 12px`, shadow `0 1px 4px rgba(0,0,0,.06)`, mb 10px, text .84rem `#2c3e50` lh 1.45 500); if details: card bg #fff radius 8px border `1px solid #e2e8f0` padding `10px 12px`, heading "How to resolve:" .78rem 700 `#4a5568` uppercase ls .5px, `ul` .8rem `#4a5568` lh 1.5 padding-left 18px, li mb 3px. Buttons column gap 6px mt 12px:
- `USERID_EXISTS|USERID_INVALID`: `variant=warning size=sm` "`fas fa-magic` Generate Suggested User ID", 700, .82rem, bg `linear-gradient(135deg,#f39c12 0%,#e67e22 100%)`, border `#d35400`, white text → hide + `suggestUserId()` after 150 ms.
- `DEVICE_EXISTS|EMAIL_EXISTS`: `variant=primary size=sm` "`fas fa-sign-in-alt` Go to Login Page" bg `linear-gradient(135deg,#2980b9 0%,#3498db 100%)` no border → `navigate('/login')`; `EMAIL_EXISTS` also `variant=outline-secondary size=sm .78rem 600` "`fas fa-key` Forgot Password?" → `navigate('/login',{state:{openForgotPassword:true}})` (**Login.js never reads `openForgotPassword`** — no-op beyond navigation).
- Always last: `variant=dark size=sm` bg `#2c3e50` no border padding 6px 600 .82rem: label `"Fix Now"` if `fieldToFocus` else `"Got It"` → hide + focus field after 150 ms.

### 3.2 RegistrationSuccessModal
`Modal centered backdrop=static size=sm` (no compact class). Header `bg-primary text-white py-2` closeVariant white, title `fs-6` `fas fa-check-circle` "Registration Successful". Body `p-3 text-center`:
- `Alert success py-2 px-3 mb-3 text-start .85rem`: admin → "**Registration successful!**<br/>The account is active and credentials are created."; public → "**Dear {userName},**<br/>An activation link has been sent to **{email || 'your email'}**. Please click it to start your trial."
- Info box `bg-light p-2 rounded border mb-3 text-start text-muted .8rem` rows (flex space-between): Name (text-dark) / User ID (`text-primary fw-bold`) / Subscription (`Badge bg=info` "{type} Plan") / Tehsil (joined tehsil names, or "Full System Access" when no assignments; max-width 60%, break-word).
- Italic note `.75rem`: "Note: After your trial period ends, please contact the admin for payment and renewal." (shown for admin too).
- `variant=primary size=sm w-100 fw-bold` "OK" → onHide.

---

## 4. Admin user registration — `/admin/register` (`components/Auth/UserRegistration.js`)

**Access**: admin only (ProtectedRoute). Reached from NavigationMenu admin submenu.

**Page**: `Container fluid className="registration-form-container py-4 px-3 px-md-4"`. Header row `d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom`: `h3.fw-bold.m-0` "Admin User Registration" color `#0A2540`; right `Button variant=outline-primary` "`fas fa-home` Home" → `navigate('/')`.

**Defaults**: `{userName:'',userId:'',password:'',confirmPassword:'',mobileNumber:'',email:'',startDate:getCurrentDate(),subscriptionType:'Trial',userType:'user',fee:1000}`; `showPassword` **true by default**. Tehsil list = full `fetchConsolidatedTehsils()` (AKAR included).

**Auto-generation**: whenever `userName` and `mobileNumber` both set and mobile has ≥5 digits: password = `Capitalized(nameWithoutSpaces, rest lowercase)` + `@` + last 5 digits of mobile → sets both password and confirmPassword (overwrites manual edits whenever name/mobile change). `suggestUserId()` = `name.lower.replace(/\s+/g,'.') + '_' + (last 4 digits || random 1000–9999)`. `userType==='admin'` → `subscriptionType='Permanent', fee=0`.

### Card A "Basic Information" — border `1px solid #cbd5e1`, radius 8px; header bg `#1e293b` white 600 `fas fa-user-circle`; body padding 25px bg `#f8fafc`. Labels `fw-semibold`, groups `mb-4` (mobile `mb-3`).
| Label | name | placeholder | notes |
|---|---|---|---|
| User Name * | userName | `Full Name` | required, autofocus |
| Email Address | email | `email@example.com (Optional)` | optional |
| Mobile Number * | mobileNumber | `+92 300 1234567` | required; hint `text-muted`: "Directly paste contact number from WhatsApp (e.g. +92 345 6789012)" |
| User ID * | userId | `username_123` | "SUGGEST ID" button (dark sm, radius 3px, .7rem, `1px 8px`, bg `#1a1a1a`, uppercase, ls .5px) |
| Password * | password | `Auto-generated or type password` | eye toggle link absolute right 5px, `#6c757d` |
| Confirm Password * | confirmPassword | `Repeat password` | |

### Card B "Subscription Details" — border `#a7f3d0`; header bg `#0f766e` `fas fa-file-invoice-dollar`; body bg `#f0fdf4`. Four `md=3` cols:
| Label | name | type | notes |
|---|---|---|---|
| Start Date * | startDate | `type=date` | default today (GMT+5) |
| Subscription Type | subscriptionType | select | all 7 options, labels `"{value} ({days} days)"` / `"Permanent (Permanent)"` |
| User Type | userType | select | "User"; "Admin" option only when viewer is admin; disabled otherwise |
| Fee (PKR) * | fee | number | default `1000`; stored as Number |

### Card C "Tehsil & Mouza Access" — hidden when `userType==='admin'`. Border `#fde68a`; header bg `#b45309` `fas fa-shield-alt`; body bg `#fffbeb`. 3 cols `md=4` (col1/col2 borderRight `2px solid #f8f9fa`, paddings 25px).
- **Col 1 "Available Tehsils"** (h5 1rem 600 `#495057`): search input sm `Search tehsils...` with red `✕` clear button (`input-clear-btn-red` class + inline: absolute right 8px, red, .85rem) when text present (clears & refocuses); **"Copy List"** `outline-secondary sm` (disabled unless tehsil selected and mouzas loaded) → copies `Tehsil Name:{t}\nMouza availble as of now:{n}\nS.No   Mouza Name\n` + `{idx padEnd 7}{name}` lines (sorted) and `alert("Copied {n} mouzas of {t} to clipboard!")`. List maxHeight 250px: items padding `8px 10px`, mb 6px, radius 6px, bg selected `#e3f2fd` / group `#f0f9ff` / white, border selected `#2196f3` / group `#bae6fd` / `#dee2e6`, borderLeft `4px solid #0284c7` for groups; group badge `bg=info text=dark .65rem` "Merged Group".
- **Col 2 "Select Mouzas"** + `Badge bg=primary pill .75rem` "{n} selected". States: no tehsil → 380px dashed box (`2px dashed #dee2e6`) `fas fa-mouse-pointer` 2rem "Select a tehsil to view mouzas"; loading → 380px box with `spinner-border text-primary` + "Loading mouzas for {t}..." (`text-primary fw-bold`); loaded → column height 380px: search sm `Search mouzas...` (ref), button row **Select All** / **Clear** (`outline-secondary sm flex:1 .75rem`), scroll box border `#dee2e6` radius 6px padding 5px, items (assigned first, then unassigned, each `localeCompare numeric`): padding `8px 12px`, bg `#d4edda`/white, border `1px solid #28a745`/`#dee2e6`, radius 6px, .85rem, color `#155724`/`#495057`, weight 500/400, custom 16px checkbox square (bg `#28a745` + white ✓ 10px when checked, border `#28a745`/`#adb5bd`, radius 3px).
  - After mouzas load: info message `The {n} mouzas of {t} is loading completed.` shown in the notification modal and auto-dismissed after 1 s. Failure → danger `Failed to load mouzas for {t}`.
- **Col 3 "Assigned Access Summary"** (+ small "Review all tehsils and mouzas assigned to this user"). Empty: 250px dashed box `fas fa-lock` "No access assigned yet". Else maxHeight 250px, cards sorted by tehsil name: border `1px solid #28a745` if primary else `#dee2e6`, radius 8px, no shadow, body `8px 12px`; strong name .85rem + `Badge success .6rem` "Primary"; `Badge secondary .65rem` "{n} mouzas" + caret toggles expanded list; icons edit/star/trash as in public form; expanded rows additionally have per-mouza delete `fas fa-times-circle text-danger .9rem` that removes the mouza from the assignment (and from selection if that tehsil is selected). (Inline style keys `justifycontent/alignitems/minwidth/marginbottom` are lowercase typos → ignored by React, so that row is NOT flex-spaced; buttons just follow inline.)

### Buttons row `registration-buttons-row d-flex gap-3 mt-4 mb-5`
- **Reset Form** `variant=secondary reg-btn` padding `12px 35px` radius 8px 600 .95rem → `handleCancel()` resets everything.
- **Register User** `variant=primary type=submit reg-btn btn-primary-gradient` same padding; bg navy radial gradient + border `rgba(0,255,255,.4)` (same as public); sm spinner while loading.

**Submit logic**: auto-commits current `selectedTehsil+selectedMauzas` into assignments; `finalActiveTehsil = activeTehsil || first`. Validation (danger message in notification modal): non-admin with no assignments → "Please assign at least one tehsil." + `window.scrollTo(0,0)`; mismatch → "Passwords do not match." (clears confirm, focuses it); `password.length < 8` → "Password must be at least 8 characters long." (no complexity check). Request `POST /api/admin/users/register` body `{...formData, tehsilAccess: admin?[]:final, activeTehsil: admin?'':final}` (includes confirmPassword, fee number, startDate, userType). Success → builds quick-login link `${origin||'https://dashboard.naqsha-zameen.pk'}/login?t=${btoa(JSON.stringify({u,p}))}` and copies `User ID: {id}\nPassword: {pw}\n\nQuick Login Link:\n{link}` to clipboard (navigator.clipboard or textarea fallback); opens RegistrationSuccessModal (`isAdminRegistered`) with `{userName,userId,password,subscriptionType,tehsilAccess}`; resets form. Failure → danger `data.error || data.errors[0].msg || 'Registration failed. Please try again.'`; if message contains "email already exists" → clears email and focuses it.

**Notification modal**: identical markup to §3 (Error / Notification, compact).

**Responsive**: `registration-form-container` mobile rules (§1.5): full-bleed cards, stacked columns, centered buttons max 200px each.

---

## 5. Reset password — `/reset-password?token=…` (`components/Auth/ResetPassword.js`)

**Access**: public (link from email). **On mount**: clears `sessionStorage.user`, `setUser(null)`, `POST /api/logout {clearAll:true}`, then expires cookies `authToken`, `adminAuthToken`, `x-csrf-token` for path `/`, current host and `.parent.domain` — i.e. opening the link logs out every session on the device.

**No token** → `Container mt-5` with `Alert danger` "Invalid reset link. Please request a new one from the login page." + default Button "Go to Login" → `/login`.

**Layout**: wrapper minHeight 100vh flex center bg `#f4f6f9` padding 20px; `Row justify-content-center > Col md=5`; Card no border radius 16px shadow `0 10px 30px rgba(0,0,0,.08)`, body padding 40px. Header centered mb-4: 60px circle bg `#e7f0ff` color `#0d6efd` with `FaLock` 1.5rem; h3 700 `#212529` "Reset Password"; p `#6c757d` "Enter your new secure password below". Alert radius 10px .9rem.

**Fields** (labels .9rem 500; `InputGroup` with input radius `10px 0 0 10px` height 45px and `outline-secondary` eye button radius `0 10px 10px 0`, no left border):
| Label | placeholder | validation |
|---|---|---|
| New Password | `Min. 8 characters` | JS: `password.length < 6` → "Password must be at least 6 characters." (placeholder says 8, code enforces 6) |
| Confirm Password | `Re-enter password` | mismatch → "Passwords do not match." |

**Button**: "Update Password" (`"Processing..."` while loading), primary, 100% width, height 45px, radius 10px, 600, bg `#0d6efd`, no border. `POST /api/reset-password {token,password}` → `data.userId` stored, success modal shown; error danger `data.message || "Failed to reset password. The link may be invalid or expired."`.

**Success modal** (`centered backdrop=static size=sm modern-modal-compact`): header bg `radial-gradient(circle at 20% 20%, rgba(40,167,69,.35), transparent 60%), linear-gradient(135deg, rgba(11,14,40,.9), rgba(18,26,54,.92))`, white, padding `6px 12px`, title .95rem 600 `fas fa-check-circle` "Reset Successful"; body centered p-4: `fas fa-check-circle` 3rem `#28a745`, h5 700 `#2c3e50` "Password Updated!", p `#6c757d` .85rem "Your password has been changed. You have been logged out from all other devices for security.", p `#0d6efd` .82rem 500 with sm spinner (borderWidth 2px) "Redirecting to login..."; footer no border padding `10px 15px`: full-width button "Go to Login" bg `linear-gradient(135deg,#667eea 0%,#764ba2 100%)`, radius 6px, padding 10px, 600, .9rem. **Auto-redirect after 2000 ms** (and on button/close) → `navigate('/login',{state:{userId, focusPassword:true}})`.

---

## 6. Verify email — `/verify-email?token=…` (`components/Auth/VerifyEmail.js`)

**Access**: public (activation link emailed by `/api/register`). On mount: no token → error "No verification token was provided."; else `GET /api/verify-email?token=…`; **if that throws, retries `GET /verify-email?token=…`** (no `/api` prefix). Success → `verifiedUserId = data.userId`. Error → `data.error || 'The activation link is invalid or has expired. Please contact support or register again.'`.

**Layout**: full-viewport flex center, bg `rgba(15,23,42,0.55)`, padding 16px. `Card.modern-modal-compact` width 100% maxWidth 320, no border, radius 8, shadow `0 10px 30px rgba(0,0,0,.35)`. Header bg = profile gradient (`radial-gradient(circle at 20% 20%, rgba(45,152,255,.35), transparent 60%), linear-gradient(135deg, rgba(11,14,40,.9), rgba(18,26,54,.92))`), white, padding `6px 12px`, `.95rem 600` `fas fa-user-check` "Account Activation". Body padding `10px 12px` .8rem.
- Loading: sm primary spinner + muted "Verifying your email and activating your account..."
- Success: `fas fa-check-circle` 2rem `#28a745` centered; bold green "Account Activated Successfully!"; rows (flex space-between, padding 2px 0, border-bottom `#f1f3f5`): "User ID" → `<code>` (bg #f8f9fa, `1px 4px`, radius 3, `#495057`, .75rem, border #e9ecef); "Status" → pill bg `#28a745` white radius 15 `2px 8px` .7rem "Trial active"; muted .75rem "Your email has been verified and your trial access is now active. Log in to explore the dashboard."
- Failure: `fas fa-times-circle` 2rem `#dc3545`; bold red "Activation Failed"; `Alert danger py-1 px-2 .75rem` errorMsg.
Footer (border-top #e9ecef, padding `8px 12px`, flex gap 8, white): success → "Go to Login" (navy gradient button style `btn(navy)`: flex 1, no border, `8px 4px`, radius 6, 600, .8rem); failure → "Register Again" (bg `#6c757d`, Link `/register`) + "Login" (navy, Link `/login`).

**Go to Login**: reads `sessionStorage.pending_activation_creds`; if present and (`parsed.userId === verifiedUserId || !verifiedUserId`) → `navigate('/login',{state:{prefill:{userId,password},activationSuccess:true}})` else `{state:{userId:verifiedUserId,activationSuccess:true}}`.

---

## 7. Other activation / demo entry points (summary; owned by Admin slice)
- `/demo/:token` → `components/Admin/DemoAccess` (root `src/DemoAccess.js` is the dead twin: `window.location.replace(`${API}/demo-access/${token}`)`, text "Preparing demo access…").
- `/admin/activate/:token` (AdminActivate): if not logged in → `navigate('/login?redirect=/admin/activate/{token}')`; `GET /api/admin/resolve-token/:token` → `navigate('/users?activateUserId={userId}')` (UserList auto-opens UserEditForm on the Subscription tab).
- `/activate/:token` (CustomerActivatePage): `GET /api/activation-info?token`, `POST /api/activate {token, deviceId}`; `/subadmin/activate/:token`: `GET /api/subadmin/activation-info`, `POST /api/subadmin/activate {…, paymentDetails:{jazzcash:{title,number}, easypaisa:{title,number}, phone, whatsapp}}` (placeholders "JazzCash account title", "JazzCash number 03xxxxxxxxx", "EasyPaisa account title"); `/confirm-email/:token`: `POST /api/confirm-email-change {token}`.

---

## 8. Profile / Forgot-password / Change-password modals (user side)

### 8.1 ProfileModal (`App/Modals/ProfileModal.js`) — opened from navbar profile
`Modal centered className="modern-modal-compact" size=sm`. Header = profile gradient (§6), padding `6px 12px`, title .95rem 600 `fas fa-user-circle` "Profile". Body padding `10px 12px`, column gap 6px, .8rem. Rows (`ROW_STYLE`: flex space-between, padding `2px 0`, border-bottom `1px solid #f1f3f5`; label 500 `#6c757d`): Name (`#212529` 600); User ID (`<code>` as §6); Email (`user.email || 'Not Set'`); Mobile; **Tehsils** label + `Badge primary pill .7rem 3px 6px` count, then `Form.Select size=sm` (`.8rem`, radius 4, border `#dee2e6`, `4px 8px`, height 30px) "-- Select Tehsil --" + user.tehsilAccess; **Mouzas** + `Badge success pill` count, select disabled until tehsil chosen (bg `#f8f9fa` when disabled; option "-- Select Mouza --" / "-- Select Tehsil First --"); Plan → `Badge bg=info` bg `#5bc0de` radius 4 `.7rem 3px 6px`; Start Date (`en-GB dd MMM yyyy`, `#2c3e50`); Expires (`calculateEndDate`); Remaining → `Badge` bg `#28a745` radius 15 `4px 8px` "{calculateDaysRemaining} days".
- For `userType==='user'`: button "`fas fa-exchange-alt` Request Mouza Change" (navy radial gradient, no border, `6px 4px`, radius 6, 600, .8rem, mt 4px); disabled with title "Available while your subscription is active. Please renew first." and label "Mouza Change (renew first)" when `!canChangeMouzas(user)` → closes profile and opens ChangeMouzasModal (§10).
Footer (border-top #e9ecef, `8px 12px`, flex nowrap gap 8): "🔑 Change Password" (bg `#6c757d`, flex 1, `8px 4px`, radius 6, 600, .8rem) → `onHide(); setShowChangePassword(true)` (**dead end, nothing renders**); "Logout" bg `linear-gradient(135deg,#f093fb 0%,#f5576c 100%)` → `logout()`.

### 8.2 ForgotPasswordModal (`App/Modals/ForgotPasswordModal.js`) — opened from navbar/menu `onResetPassword` and tour
`Modal centered size=sm` (NOT compact class). Header `bg-primary text-white py-2` closeVariant white, title `fs-6` `fas fa-key` "Reset Password". Body p-3. If no logged-in user: `Form.Control size=sm id="userIdInput" placeholder="Enter User ID" required`. Info box `bg-light p-2 rounded border mb-3 text-center` .8rem "A reset link will be sent to your registered email address." Submit `variant=primary size=sm w-100 fw-bold` "📧 Send Reset Link" (`Sending...` + spinner). Calls **`POST ${API}/forgot-password`** (no `/api` prefix, unlike Login.js) `{userId}`; success alert `A reset link has been sent to your registered email: {email}` or generic sentence, then button becomes "OK"; error `data.message || 'Failed to send reset email. Please try again later.'`. Tour mode (`tourType==='changePassword'`): fake success after 1 s "📧 [TUTORIAL] A password reset link has been simulated and sent to your registered email address.".

### 8.3 ChangePasswordForm (DEAD) — for reference: compact modal "Change Password", fields Old Password / New Password / Re-enter New Password (all `type=password required`), buttons Cancel (secondary) + Save (primary); mismatch → "New passwords do not match."; success "Password changed successfully. Logging out..." then `logout()` after 1.5 s.

### 8.4 EditProfileForm (DEAD) — compact modal header class `profile-modal-header` (no CSS rule exists) title "Edit Profile" `#f8fbff`, custom `✕` close; fields User Name (text), Mobile Number (`+92` prefix addon bg `#e9ecef` border `#ced4da` radius `.25rem 0 0 .25rem` + `InputMask mask="399 9999999" maskChar=" "` placeholder `3## #######`, helper "Format: +92 3## #######"), New Password (leave blank to keep current); "Save Changes" primary w-100 → `PUT /api/users/:id {userName,mobileNumber,password?}` → "Profile updated!" and close after 1.2 s; error "Update failed: {msg}". Provider box (when `provider.isAdmin===false`): "Your provider: {name}", "Phone: …", link "Report a problem with my provider" → textarea (maxLength 1000, placeholder "Describe the problem (sent to Naqsha Zameen admin)") + "Send report" (danger sm, disabled < 10 chars) `POST /api/users/me/report-provider {message}`.

---

## 9. Subscription warning / payment UI (user side) — `App/Modals/SubscriptionWarningModal.js`

**When shown** (`buildSubscriptionWarning` in AuthContext, re-evaluated on every profile fetch; suppressed on auth pages and while the IP-misuse modal (>3 devices) is open — IP warning has priority):
- `status === 'Pending'` → `type:'payment'`, title "Account Pending Activation", message "Your account is pending activation. To activate your services, please complete the payment process below."
- `status === 'Expired'` → `type:'payment'`, "Subscription Expired", "Your subscription to Geo Map has ended. To continue accessing mouza data and map features, please renew your subscription."
- non-Permanent and `0 < daysRemaining <= 5` → `type:'expiring-soon'`, "Subscription Expiring Soon", `Your subscription will expire in {n} day(s). Please renew now to keep uninterrupted access to mouza data and map features.`, includes `endDate` (en-GB) and `daysRemaining`.
- admins never get it.

**Modal**: `centered scrollable size=sm dialogClassName="modern-modal-compact subscription-warning-dialog"`. Header bg `radial-gradient(circle at 20% 20%, {payment ? rgba(220,53,69,.35) : rgba(255,193,7,.35)}, transparent 60%), linear-gradient(135deg, rgba(11,14,40,.9), rgba(18,26,54,.92))`, padding `5px 10px`, title .88rem (CSS forces .82rem) 600 with icon `fa-credit-card` (payment, white) / `fa-hourglass-half` (expiring, `text-warning`) / `fa-exclamation-triangle`. Body `8px 10px`, column gap 5px, .8rem:
- `Alert` variant danger/warning, radius 6, padding `6px 8px`, .82rem, lh 1.3, mb 0; for payment: bg `#b91c1c`, text white, border `#991b1b`, 600; icon `fa-wallet` / `fa-clock` / `fa-info-circle`; text = message.
- expiring-soon: centered `Badge` `{n} day(s) remaining · expires {endDate}` — bg `#dc3545` white if n ≤ 2 else `#ffc107` black; .72rem, `3px 9px`, radius 12.
- **Payment block** (payment or expiring-soon): container bg `#f8f9fa` padding 8 radius 8 border `#dee2e6`; h6 "Renewal Payment Methods:" .78rem 700 `#2c3e50` border-bottom `#dee2e6`.
  - Provider details come from `authUser.provider` (`/api/profile`): `provider.easypaisa {number,title}`, `provider.jazzcash`, `provider.whatsapp`, `provider.name`, `provider.isAdmin`. **Hard-coded fallback** when provider has neither: Easypaisa AND JazzCash both `{number:'03146796144', title:'Muhammad Masoom'}`. If provider has only one method, only that box shows. WhatsApp number: `provider.whatsapp || REACT_APP_WHATSAPP_NUMBER || '923048840264'`; displayed local form `0304…` (replace leading `92` with `0`).
  - **Easypaisa box**: bg #fff, padding `7px 8px`, radius 8, border `1px solid #c6f6d5`, borderLeft `4px solid #38a169`; `<img src=icons/Easypaisa-logo.png>` 30×50 contain; number 800 1rem `#2d3748` ls .3px; **Copy** button (bg `#edf2f7` `#4a5568` → `#38a169` white + `FaCheck` "Copied" for 2 s; radius 5, `3px 7px`, .66rem 700; `FaCopy` 9px) copies digits only; "Title: {title}" .68rem `#718096` 600 with title in `#38a169`.
  - "OR" divider .62rem 800 `#a0aec0` uppercase (only when both).
  - **JazzCash box**: same with border `#fed7d7`, borderLeft `#e53e3e`, `icons/JazzCash_logo.png`, copied color `#e53e3e`, title color `#e53e3e`.
  - Yellow strip mt 6: bg `#fff3cd`, border `#ffeeba`, radius 6, .72rem 700 centered: "Share Payment Receipt to `<FaWhatsapp #25D366 1.1rem>` {waLocal}".
  - If `provider.isAdmin === false`: .68rem `#495057` "Your account is managed by **{provider.name}**."
  - Italic .66rem `#6c757d`: "* You will receive a notification here the moment your subscription is renewed."
  - **No prices/plans are displayed anywhere in this modal** (only account numbers).
- Other types: rows User / Start Date / Expires / Remaining (`Badge` `#dc3545` if ≤3 days else `#ffc107`, "{n} days").
- Footer (border-top #e9ecef, `6px 10px`, gap 6): "Close" secondary (flex 1, or `0 0 50%` centered when no renew button). **Renew Now / Activate Now** (only when `needsRenewal` = status Pending/Expired or endDate ≤ now): variant success, bg `linear-gradient(135deg,#25D366 0%,#128C7E 100%)`, flex 2, 700, .82rem, shadow `0 2px 6px rgba(37,211,102,.35)`, `FaWhatsapp` 1.15rem. Click → `POST /api/users/:userId/renewal-token {}` → `{deepLink, payFirst, message}` (`payFirst && message` → `window.alert(message)`); opens `https://wa.me/{waIntl}?text=` with:
```
*{Activation|Renewal} Request*

*User Name:* {name}
*User ID:* {id}
*Tehsil:* {activeTehsil || 'Not specified'}
*No of Mouza:* {sum of mouzas}
*Subscription:* {type || 'Not specified'}

Please pay the subscription fee and share the payment receipt screenshot here to subscribe to the services.
[\n\n*Free trial already used: paying the subscription fee to renew.*]   (if payFirst)
[\n\n{deepLink}]
```

---

## 10. ChangeMouzasModal (customer) — `components/User/ChangeMouzasModal.js`

Opened from ProfileModal button and NavigationMenu item; only when `canChangeMouzas(user)`: `userType==='user'`, status not in `['Expired','AwaitingActivation','Suspended','Pending','PendingVerification','Inactive']`, and time left > 0 (`endDate` or `calculateDaysRemaining`).

Uses `CompactModal` (profile-style header gradient, title `fas fa-exchange-alt` "Change My Mouzas", body `10px 12px` .8rem scrollable, footer `8px 12px`). Constants: `BORDER='1px solid #64748b'`; selects `.78rem radius 4 padding 2px 8px height 28px`.
On open: resets; `fetchConsolidatedTehsils()` → groups + `withoutAkar(names)`; `GET /api/me/assignment-requests/current` → `current`; default tehsil = first non-AKAR of `[activeTehsil, ...assigned]`. Mouzas via `fetchMauzas(addTehsil)`.

Body (column gap 4):
- Error `Alert danger py-1 px-2 .75rem dismissible`.
- If any assigned tehsil is AKAR: `Alert warning .72rem` `fas fa-lock` `{AKAR_MESSAGE} Your AKAR chaks stay as they are.`
- Pending request: `Alert info .75rem` "You already have a request waiting for approval (sent {dd/mm/yyyy}). Sending a new one replaces it." + link-button "Cancel that request" → `DELETE /api/me/assignment-requests/current`.
- `current.status==='invoiced'`: `Alert warning .78rem` "**Invoice {number}: Rs {amount en-PK}**, pay by {dueAt en-GB}. The mouzas are added after your payment is confirmed. Please send the payment screenshot to your provider."
- Decided within 7 days: row "Last request" → Badge success/danger/secondary `{status}` (+ ` · Rs {fee}` when approved with fee).
- `InfoRows`: 2-col grid rows (Name | User ID) and (Plan | Days left), label .68rem lh 1.1, value strong `#212529` truncated.
- "Tehsil" label + select "-- Select Tehsil --" + names (suffix ` ✓` when assigned). Box (border BORDER, radius 4): filter bar bg `#f1f5f9` padding 3 with sm input placeholder `Filter mouzas ({n})...` / `Select a tehsil first` (height 26, .76rem); list maxHeight 190: rows padding `2px 6px`, border-bottom `#e2e8f0`, bg changed ? (selected `#dcfce7` : `#fee2e2`) : #fff; name color `#166534` 600 when selected else `#334155`; changed tag .65rem "to add" (`#16a34a`) / "to remove" (`#dc2626`); round 18px button bg `#dc3545` `fa-times` when selected else `#28a745` `fa-plus`. Order: kept → newly added → removed → unchanged; numeric localeCompare. Empty: "No mouza matches." / "Loading mouzas...".
- Textarea rows 1 placeholder "Message for your provider (optional)" (.76rem, BORDER, resize vertical).
- "Summary" row: `Badge success` `+{n}` `Badge danger` `−{n}`. Muted .72rem `fas fa-info-circle` "A small fee may apply."
Footer: "Close" (grey) and "`fab fa-whatsapp` Send Request" (primary navy; disabled when busy or nothing selected). Send: opens blank tab first, `POST /api/me/assignment-requests {add:[{tehsil,mouzas}], remove:[…], note}` → `wa.me/{data.whatsappNumber || REACT_APP_WHATSAPP_NUMBER || '923048840264'}?text={data.whatsappText}` into that tab; on error closes the tab.
**Sent view**: CompactModal `fas fa-paper-plane` "Request Sent": green check 2rem, "Your request was sent to {providerName || 'your provider'}.", InfoRows (daysLeft from response), `Alert warning .78rem` "Changing mouzas may cost a **small fee**, depending on the number of mouzas and the **{daysLeft} day(s)** left in your plan. Your provider will tell you the amount. The change is made once they approve it.", muted "If WhatsApp didn't open, tap **Open WhatsApp** to send the request message."; footer "`fab fa-whatsapp` Open WhatsApp" (success gradient `#10b981→#059669`, `<a target=_blank>`) + "OK" grey.

---

## 11. User list — `/users` (`components/User/UserList.js`)

**Access**: admin. Reached from NavigationMenu "User Management" submenu, AdminActivate, deep links `?tab=`, `?owner=`, `?activateUserId=`.

**Query-param handling** (on `location.search` change): `owner` → `filterType='subadmin'`, `ownerFilter=owner`; `tab` → activeTab (and default sorts: `publicRegistration`→`createdAt desc`, `recentlyEdited`→`profileEditedAt desc`); `activateUserId` → opens UserEditForm on `subscription` tab then `navigate('/users',{replace:true})`.

**Data**: `GET /api/users` params `{page, limit:50, tab, sortKey, sortDir, searchId, owner?, searchTehsil? | searchPhone? | searchEmail?}` with AbortController (previous request cancelled). Response `{users[], statistics{total,active,expiring,expired,publicRegistration,recentlyEdited,awaitingActivation,unactivated,…}, subAdmins[], pagination{pages,total}}`. Each user enriched with `tehsilAssignments`, `activeTehsil`, `tehSummary`, `mauzaList`. Error → whole page replaced by `Alert danger` "Failed to load user data.". Debounce 500 ms on text filters; Enter key prevented.

**Page** (`.user-list-container`: padding 1.5rem, bg #fff, minHeight `calc(100vh - 42px)`, flex column, color `#2c5364`, overflow-y auto; mobile ≤768 padding .75rem):
1. Header row (`d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom`): `h3.fw-bold.m-0` "User Management" `#0A2540`; `outline-primary` "`fas fa-home` Home" → `/`.
2. **Tabs** `.user-list-tabs` (flex, gap 1rem, mb 2rem, wrap). Each `.user-list-tab` button: flex gap .5rem, padding `.5rem 1rem`, white bg, border `1px solid rgba(0,150,180,.6)`, radius 6px, color `#64748b`, .85rem 500; hover bg `#f1f5f9` color `#0ea5e9` border `rgba(0,150,180,.85)`; active bg `#e0f2fe` border/color `#0ea5e9` shadow `0 1px 2px rgba(0,0,0,.05)`; svg 1.1rem. Mobile: `flex:1 1 calc(50% - .3rem)`, centered, `.4rem .5rem`, .85rem 600, badges `.2rem .35rem .7rem`.
   | id | label | icon | badge |
   |---|---|---|---|
   | all | All Users | FaUsers | `bg=secondary` statistics.total |
   | recentlyEdited | Recently Edited | FaEdit | `bg=info` recentlyEdited‖0 |
   | active | Active | FaCheckCircle | `bg=success` active |
   | expiring | Expiring Soon | FaExclamationTriangle | `bg=warning` expiring |
   | expired | Expired | FaTimesCircle | `bg=danger` expired |
   | publicRegistration | Public Registration | FaUsers | `bg=warning` with inline bg `#ff9800` white, publicRegistration |
   | awaitingActivation | Awaiting Activation | FaExclamationTriangle | `bg=info` only if defined |
   | unactivated | Link Expired | FaTimesCircle | `bg=secondary` only if defined |
   Tab change resets page to 1 and sort (`{}` except the two dated tabs).
3. **Search/filter bar** `.search-filter-bar-new` inline: flex, gap 8px, align-end, nowrap, width 100%. Labels `.filter-label` (black, .85rem, 500; inline .85rem nowrap ellipsis). Inputs: `.autocomplete-wrapper .form-control` border `rgba(0,150,180,.65)` radius 6 color `#2c5364`, focus border `#00d4ff` shadow `0 0 0 3px rgba(0,212,255,.1)`; inline height 36px .9rem radius 6.
   - "User ID" (`flex 1 1 30%`): text placeholder `ID...`; red `✕` clear (`input-clear-btn-red` + inline: right 8px, `#dc3545` bold .9rem, no bg/border — inline overrides the circle styles) → clears + focus.
   - "Filter By" (`flex 0 0 110px`): select `Tehsil | Phone | Email | Sub-Admin` (values `tehsil|mobileNumber|email|subadmin`). Changing clears value (and ownerFilter if leaving subadmin).
   - Third group (`flex 1 1 45%`) label "Select Tehsil" / "Select Sub-Admin" / "Search Term": subadmin → select `All owners ("") | Mine (direct) ("direct") | Any sub-admin ("subadmins") | {subAdmins: userName||userId}`; tehsil → text `Type to filter tehsils...` with autocomplete dropdown on focus (`.autocomplete-dropdown`: absolute top 100%, white, border `#ccc`, radius 4, maxHeight 200, z 1000; items padding 8px: first "-- All --" then matching `tehsilOptions`; `onMouseDown` select; closes 200 ms after blur); else text `Search...`. Clear `✕` at right `30px` (tehsil) / `10px`.
   - CSS mobile: groups `flex 1 1 45%`, inputs `.35rem .6rem .8rem`, labels .85rem 600.
4. **Bulk assign bar** `.bulk-assign-bar`: flex wrap gap 6, margin `6px 0`, padding 6 (open) / `3px 6px`, bg `#eef6ff`, radius 8, border `1px solid #b6d4fe`, .7rem. Toggle text-button (`#0b5ed7` 700 .75rem): `fas fa-chevron-right/down` `fas fa-user-tie` "Bulk assign" + ` ({n} selected)` when collapsed with selection. When open: `Badge` primary/secondary "{n} selected"; `outline-primary sm` "Select all {totalFiltered} matching" (`Selecting…`; iterates `GET /api/users` pages with limit 100 up to 100 pages, collecting `userType==='user'` ids); `Form.Select sm` width auto: "Take back (manage directly)" ("") + "Assign to {name}" per sub-admin; "Apply" sm (disabled when none/assigning; `Working…`) → `window.confirm("Assign {n} user(s) to {label}?")` (label = sub-admin name or "yourself (take back)") → `POST /api/admin/users/assign {userIds (chunks of 500), subAdminId|null}` summing `moved`/`skipped`; notice success/warning `"{moved} user(s) assigned to sub-admin {label} ({id})."` or `"{moved} user(s) taken back. You now manage them directly."` + ` Skipped: a, b.`; error → page error `data.message || 'Assignment failed.'`; "Clear" `outline-secondary sm`. CSS: bar buttons/selects `.7rem`, padding `.15rem .45rem`, badges .62rem. Row checkboxes only render while open.
5. **Loading**: first load → centered box (white, radius 12, border `1px solid rgba(0,212,255,.2)`, py-5 my-5) primary spinner + "Loading users..." (`#64748b` .85rem). Subsequent loads → 3px top bar `linear-gradient(90deg,#00d4ff 0%,#090979 50%,#00d4ff 100%)` bg-size 200% animated `loadingBar 1.5s infinite linear`.
6. **Empty**: `.empty-state` (centered, padding `4rem 2rem`, white, radius 12, border `1px dashed rgba(0,212,255,.3)`): icon FaUsers 4rem `rgba(0,212,255,.3)`; title "No Users Found" 1.5rem `#6c757d` 600; "Try adjusting your search or filter criteria" `#64748b`.
7. **Table** `.user-list-table-wrapper` (white, radius 12, overflow auto both, border `1px solid rgba(0,212,255,.2)`, flex 1, minHeight 250, maxHeight `calc(100vh - 350px)`; mobile radius 8). `.user-list-table`: `border-collapse:separate; border-spacing:0`. thead bg `linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)` with 2px bottom glow `linear-gradient(90deg,transparent,rgba(0,255,255,.6) 50%,transparent)`; `th` sticky top (z 103, opaque `#203a43 !important`, hover same), padding `.38rem .6rem`, centered, color `#00ffff`, 600, .85rem, uppercase, ls .05em, border-bottom `2px solid rgba(0,255,255,.4)`, border-right `1px solid rgba(0,212,255,.2)`, nowrap; `.th-content` flex center gap .5rem; sort indicator ` ▲`/` ▼` color `#a855f7` .75rem. First column `.freeze-column` sticky left (th z 105 bg `#1b333c`; td z 101 bold, shadow `2px 0 5px rgba(0,0,0,.2)`, opaque bg per row state: odd #fff / even `#e9ecef` / active `#d1e7dd` / expiring `#fff3cd` / expired `#f8d7da` / pending `#ffe8cc`, hover `#e6f7fb`). `td`: padding `.32rem .6rem`, color `#2c5364`, .88rem, border-right `.5px solid rgba(0,150,180,.25)`, border-bottom `.5px solid rgba(0,150,180,.3)`→ overridden later to `1px solid rgba(0,212,255,.1)`, nowrap. Even rows `#e9ecef`; hover `rgba(0,212,255,.05)`. Mobile: th `.34rem .425rem .75rem 700`; td `.298rem .425rem .78rem`.
   **Row class** `user-list-row status-{active|pending|expiring|expired}`: `status==='Active'`→active; `'Pending'`→pending; `0<daysRemaining<=7`→expiring; else expired. Colors: active bg `rgba(16,185,129,.12)` + borderLeft `4px solid #10b981`; expiring `rgba(245,158,11,.12)`/`#f59e0b`; expired `rgba(239,68,68,.12)`/`#ef4444`; pending `rgba(255,193,7,.15)`/`#ffc107` (all `!important`).
   **Columns** (in order):
   | Header | sort key | cell |
   |---|---|---|
   | (checkbox, 28px) — only when bulkOpen | — | header checkbox selects all `userType==='user'` on page; row checkbox only for `userType==='user'` |
   | User (freeze) | `userName` | `<span class="user-id user-id-only" title={userName}>{userId}</span>` — bold, color `var(--brand-primary,#002366)` (= `#0096c7` since token defined), .88rem (CSS `:has(.user-id-only)`), mobile .78rem; click opens UserEditForm (`title="Click to edit user"`) |
   | Tehsil | `activeTehsil` | `.user-tehsil` color `#7c3aed` |
   | Mouzas (title "Number of mouzas assigned (across all tehsils)") | — | centered: `—` muted if no access; else `Badge bg=primary/secondary .8rem` count, plus `+all` muted .7rem when any tehsil has empty mouza list; title lists `tehsil: n|all` per line |
   | Days Left | `daysRemaining` | `Permanent` / `{n} days` / `Expired` |
   | Subscription | `subscriptionType` | text |
   | Phone | `mobileNumber` | `mobileNumber || 'N/A'`, nowrap |
   | Sub-Admin | — | `Badge bg=primary` subAdminName or `—` (.8rem) |
   | Type (hidden on publicRegistration tab) | `userType` | Badge: admin→danger, subadmin→primary, demo→info, else secondary; text `userType || 'Regular'` |
   | Registered At (publicRegistration only) | `createdAt` | `formatDateTime` en-GB `dd MMM yyyy, hh:mm:ss am/pm`, .8rem `#334155` |
   | Status (publicRegistration only) | `status` | `Badge success` "Active" if status Active/Trial else `Badge secondary` bg `#6c757d` "Inactive" (.8rem, `4px 8px`) |
   | Actions (tabs `pending` or `publicRegistration`) | — | `Button variant=success size=sm` "Activate" (`2px 8px .8rem bold`) → `PUT /api/users/:id {status:'Active'}` → notice "User {id} activated successfully." / "Failed to activate user {id}."; else muted "Activated" |
   Sorting: click toggles asc/desc; first click on `createdAt`/`profileEditedAt` starts desc, others asc. Server-side.
8. **Pagination** `.pagination-controls` (flex space-between, mt 1rem, padding `.5rem 1rem`, border `1px solid rgba(0,212,255,.2)`, radius 8): "Showing {n} of {total} users" (`#2c5364` .9rem 500); buttons `outline-primary` `FaAngleDoubleLeft/FaAngleLeft/FaAngleRight/FaAngleDoubleRight` (CSS: white bg, border `rgba(0,212,255,.3)`, color `#2c5364`; disabled opacity .3); "Page {p} of {pages||1}" 600. Mobile: smaller paddings .75rem.

**Notice modal** (`modern-modal-compact`): title "Error"/"Notification"; text `text-danger fw-bold`/`text-success fw-bold`; optional `whatsappMessage` textarea (rows 6, readOnly, .85rem monospace bg `#f8f9fa`) + `variant=success w-100 fw-bold` "Copy WhatsApp Message" (alert "Copied to clipboard!" / "Failed to copy. Please manually copy from the box.") — this branch is never populated in current code; footer Close (danger/primary).

**Delete modal** (state exists but no row action sets `userToDelete` in current UI — dead UI): "Confirm Delete" / "Are you sure you want to delete this user?" / Delete (danger, `DELETE /api/users/:id`) + Cancel.

**Dead handlers kept in file** (no UI trigger in current render): `handleLoginAs`, `handleResetPassword` (uses `resetPasswordAndCopy`, confirm text "Reset the password for {uid}? A new random password is made and a WhatsApp message is copied to the clipboard."), `handleCreateDemoLink` (prompt "Enter demo access duration in days (e.g. 2 for two days):" default `'1'`; `POST /api/users/:uid/demo-links {expiresInMinutes}`; builds `${apiOrigin}/demo-access/{token}` and WhatsApp message `Dear *{name}*,\n\nHere is your Quick Login Link (valid for {days} days):\n{link}\n\n- Total Mouzas: *{n}*\n` + device warning when `ipCount30>=5` + `\nThanks,\n*GeoMatrix Technologies*`; notice "Quick Login Link generated and copied!"), `handleActivateSubscription(uid,days,type)` (prompt "Enter payment amount (Rs) for {type}:" default `'1000'`; endpoints `/api/subscriptions/:uid/activate-trial` (days 5) / `activate-monthly` (30) / `activate` body `{paymentAmount,days,subscriptionType}`; copies renewal WhatsApp message; notice "{type} activated successfully! WhatsApp message copied to clipboard."), `generateWhatsAppMessage`, `formatMouzaList`. `subscription-buttons.css` / `action-buttons.css` classes are imported but **no `.subscription-buttons` markup exists** in UserList now (action-buttons classes are used inside UserEditForm sections).

---

## 12. User edit modal — `UserEditForm` (opened from UserList row click / `?activateUserId`; also used by Admin SubAdminUsers)

**Props**: `userId`, `handleClose`, `refreshUsers`, `initialTab='profile'`. `isSubAdmin = userType==='subadmin'` hides admin-only parts; `signOff` = `'GeoMatrix Technologies'` for admin, else `${subadmin.userName}\n${mobile}`; `planOptions` for sub-admin = Monthly, Yearly only.

**Load**: `GET /api/users/:userId` → form `{userName,userId,email,password (plaintext if server returns string),mobile,startDate (ISO date),subscriptionType,endDate (computed),status ('Pending' kept; else calculateStatus; else user.status||'Unknown'),fee (?? 1000),renewalHistory,ipMisuse}`; `passwordIsHashed = user.passwordIsHashed`; assignments from `tehsilAccess` (+`tempGrants`) or legacy `tehsil/mauzaList`; active/selected tehsil = `activeTehsil` or first; `GET /api/assignment-requests/user/:userId` → `{request, invoicesEnabled}`. Tehsils: `fetchConsolidatedTehsils()` (`withoutAkar` for sub-admin). Mouzas per selected tehsil: `fetchMauzas` merged with assigned + `localStorage geo_known_mouzas_*`. While `!form` → `Alert info` "Loading…" (rendered in place of the modal).

**Modal**: `show centered size=lg dialogClassName="unified-modal user-edit-modal"` (max-width 580px, content max-height 90vh). Header: "Edit User: {userName}". Body `p-0`, height `85vh`, flex column, overflow hidden.
- `msg` → `Alert {type} m-2 mb-0 py-2 px-3`.
- **Pending mouza change request panel** (when `changeReq`): `m-2 mb-0 p-2`, border `2px solid #f59e0b`, bg `#fffbeb`, radius 8, .8rem. Header: `fas fa-exchange-alt text-warning` "Pending mouza change request" + muted .72rem `{createdAt en-GB} · {daysLeft} day(s) left on {plan}`. `<details>` summary `+{nAdd} add` (green) ` · ` `−{nRem} remove` (red) "(tap to show mouzas)"; table (`table-sm table-bordered .75rem`, sticky thead bg `#fef3c7`, cols Change 70px / Tehsil 130px / Mouzas; row bg `#f0fdf4` add / `#fef2f2` remove), box maxHeight 28vh border `#e2c27a`. `Customer: “{note}”`. Three modes:
  - `status==='invoiced'`: box "**Invoice {number}: Rs {amount}** · due {date}" + .72rem breakdown (`{plan} Rs {planFee} + mouzas Rs {mouzaFee}` for trial, else `Rs {monthlyPrice}/month × {daysLeft} day(s) ÷ 30`) ` · new fee Rs {newFee}`; input "Payment ref / TID (optional)"; `success sm` "`fas fa-check-double` Confirm payment" → `POST /api/assignment-requests/:id/confirm-payment {paymentRef}`; `outline-danger sm` "Cancel invoice" → confirm "Cancel this invoice and reject the request?" → `/reject {reason}`. Note .7rem "The mouzas are added only when you confirm the payment[ (the amount is then added to your bill)]."
  - `!MOUZA_INVOICES` (invoices switch off, default): number input "Fee (Rs)" width 110 + "Note / payment ref (optional)"; "`fas fa-check` Approve" → requires fee (warning "Enter the fee for this change (0 if free) before approving.") → `/approve {fee:Number, note}`; "Reject" (confirm "Reject this mouza change request?"). Note: "Check the customer's payment, enter the fee (0 if free) and approve; the mouzas change straight away[ and the fee is added to your bill]."
  - invoices on: inputs "Added mouzas Rs/month" (w160, if nAdd), for trial customers also select Monthly/Yearly (w105) + "{plan} fee (Rs)" (w130); "Fee reduction (Rs)" (w140, if nRem); "Note (optional)". Live preview .75rem: `Invoice: Rs {amount}` (`{plan} Rs {planFee} + mouzas Rs {mouzaPart}` or `Rs {price} × {days} day(s) ÷ 30`, "rounded up to Rs 50") or "No charge (removal only)." ` · New subscription fee: Rs {newFee}`. Formulas: `mouzaPart = nAdd ? (trial ? (plan==='Yearly'? price*12 : price) : price*days/30) : 0`; `amount = nAdd ? ceil((trial?planFee:0 + mouzaPart)/50)*50 : 0`; `newFee = max(0, (trial&&nAdd ? planFee+mouzaPart : fee + (nAdd ? (currentPlan==='Yearly'? price*12 : price) : 0)) - reduction)`. Buttons "`fa-file-invoice` Send invoice" (when amount>0 or trial+add) else "`fa-check` Approve" → `/approve {monthlyPrice, plan, planFee, feeReduction, note}`; "Reject". Note: "Additions: the customer gets an invoice (due in 3 days) and the mouzas are added after you confirm the payment. Removals are applied straight away with no refund." Validation warnings: "Enter the monthly price of the added mouzas (0 if free)." / "Trial customer: enter the subscription fee of the plan."
  - After any decision: `refreshUsers()`; if `data.invoiceText` → copied to clipboard and message gets " Invoice text copied for WhatsApp."; confirm or approve-applied → `alert(data.message)` + close; else success msg + reload.
- **Sticky tab header** (`.user-detail-tabs-container sticky-top`, shadow `0 2px 6px rgba(0,0,0,.05)`, white, border-bottom `#e2e8f0`): `.user-list-tabs` inline nowrap, gap 4px, overflow-x auto, padding `6px 8px 0`. Tabs (`.user-list-tab` styles §11 + inline `padding .35rem .25rem`, `.65rem`, flex `1 1 auto`, icon .7rem): 👤 Profile, 💳 Subscription, 🔐 Access (+ `Badge success .55rem` count of tehsils), 🌐 Multi-Use Info (hidden for sub-admin; `Badge` count of `ipMisuse.count30`: `>3 && <8` → warning w/ black text, `>=8` → danger, else success). **Subscription tab colour** by state: Expired/`daysRem<=0` → bg `#f8d7da` color `#842029` border `#f5c2c7` 700; `daysRem<=2` → `#fff3cd`/`#664d03`/`#ffecb5`; else `#d1e7dd`/`#0f5132`/`#badbcc`. `has-error` class (red) set per tab on validation failure; clicking the tab clears it.
  - **Action grid on Profile tab** (`grid repeat(3 or 2 for sub-admin, 1fr)`, gap .5rem, mb-2 mt-2 px-1; all `size=sm py-1 px-2 .72rem 600 height 28px`, icons .85rem):
    | Button | variant | icon color | action |
    |---|---|---|---|
    | Login As | outline-success | `fa-sign-in-alt` #28a745 | `loginAs(userId)`; error `alert('Failed to login as user.')` |
    | Quick Login | outline-secondary | `fa-key` #fd7e14 | `resetAndCopy(true)` → `resetPasswordAndCopy` with quick link (§12.4); updates form.password |
    | Demo Link | outline-secondary | `fa-link` #0d6efd | prompt days (default '1') → `POST /api/users/:id/demo-links {expiresInMinutes}` → `alert("Demo link created and copied to clipboard:\n{link}")` + clipboard |
    | View Details (admin only) | outline-info | `fa-eye` #17a2b8 | close + `navigate('/users/:id')` |
    | Copy Mouzas | outline-primary | `fa-copy` #6f42c1 | copies `Total Tehsil Access={t}\nTotal No. of Mouza={m}\n` + per tehsil `\n{tehsil}\nNo. of mouza={n}\n1. m…`; alert "Mouza list copied to clipboard!" |
    | Delete User (admin only) | outline-danger | `fa-trash` #dc3545 | confirm `Are you sure you want to delete user {id}?` → `DELETE /api/users/:id` → alert "User deleted successfully." + close + refresh; error alert `data.message || 'Failed to delete user.'` |
- **Scrollable content** `.tab-content-wrapper flex-grow-1` padding .75rem (CSS override `10px 16px`).
- **Footer** (border-top, bg `#f8f9fa`, `p-2 px-3`): left muted bold .75rem `No of Tehsil={t}` `Total No of Mouza={m}`; right: **Activate User** (only `form.status==='Pending'` on Subscription tab; variant success with inline bg `#146c43` border `#13653f`; `Activating...`) → `POST /api/subscriptions/:id/activate {type: subscriptionType||'Monthly'}` → updates status/start/end from `data.subscription`, msg "User activated successfully." / `data.message || 'Failed to activate user.'`; **Save Changes** (primary, submit; spinner + "Saving..."); **Cancel** (secondary).

### 12.1 ProfileSection (padding 8px; `Row g-2`, `md=6` cols; labels `mb-0 small fw-bold`; all inputs `size=sm`)
Fields: **User ID** (disabled); **User Name** (required; disabled until its pencil `FaEdit` button (`outline-primary sm`, `1px 3px .6rem`, absolute right 5px) toggles `editableFields.userName`); **Email** (type email, pencil); **Password** (type `text` for admin viewers, `password` otherwise; autocomplete off; pencil; `text-warning .7rem` "Hashed" when `passwordIsHashed`; typing clears hashed flag); **Mobile** (text, formatted via `formatPhoneNumber`, pencil inline right). All edit toggles default **locked**.

### 12.2 SubscriptionSection (`.dark-gray-borders`, padding 8, minHeight 350)
- **Start Date**: `CustomDatePicker` (§12.3). **Type**: select "Select" + options `"{value} ({days}d)"` / `"Permanent (Perm)"`. **End Date**: disabled, `formatEndDateToDMY`. **Status**: disabled, class `text-success fw-bold` (Active) / `text-warning fw-bold` (Pending) / `text-danger fw-bold`. **Fee (₨)**: number min 0 required.
- End date & status recomputed on start/type change (`calculateEndDate/Status`).
- **Recent History** (if renewalHistory): box `mt-2 p-2 border rounded bg-light`; `Table striped bordered hover size=sm .7rem` with `thead.table-dark` Date / Type / Fee; last 3 entries (reversed) — fee `text-success fw-bold` `₨{paymentAmount||0}`.
- Below (in UserEditForm): if `proofHiddenReason` (Trial plan → "Trial selected: no payment, so no payment proof is needed."; non-Permanent plan already expired by date → "With this start date and plan the subscription is already expired, so nothing is activated: no payment proof, and it is not counted as a renewal or revenue.") → italic muted `fas fa-info-circle` note. Else **PaymentProofInput** (compact) + row: muted .72rem "Renewing now? It is attached when you save. Proof for a renewal already done? Use the button, no new renewal is made." + `outline-info sm` "`fas fa-paperclip` Attach to last renewal" (`Saving…`) → needs proof else "Add a screenshot or paste the payment SMS first, then click Attach."; `uploadPaymentProof({kind:'renewal',userId,proof,attachToLatest:true})` → "Proof attached to the last renewal. No new renewal was recorded." / error. Then **RenewalProofList** (`GET /api/payment-proofs?kind=renewal&userId=`): heading `fas fa-receipt` "Payment proofs (n)" .8rem 600 `#475569`; empty "No payment proof attached to this customer's renewals yet."; rows (border box maxHeight 180): date en-GB bold, badges `info` "screenshot", `secondary` "SMS", `warning text-dark` "unlinked"; truncated SMS; "View" `outline-info sm` → ProofModal (`unified-modal sa-lg-modal` size lg: "Payment proof"; per proof "Added {en-PK datetime} by {uploadedBy} [Badge light uploaderRole]", image via `GET /api/payment-proofs/:id/file` (blob, max-height `calc(100vh - 260px)`, link opens full size), SMS text box bg `#f1f5f9` monospace .85rem, note).
- **PaymentProofInput**: dashed box border `1px dashed #94a3b8` bg `#f8fafc` p-2; title `fas fa-paperclip` "Payment proof (optional)" .8rem 600 `#475569`; "Remove" link (red) when any; 84×84 `outline-primary` button `fas fa-image` 1.4rem "Add screenshot" (or preview thumbnail, click to replace; hidden file input `accept=image/*`); textarea rows 2 (compact) maxLength 2000 placeholder "Paste the payment SMS / confirmation text here (optional). You can also paste a screenshot with Ctrl+V." (.85rem, minHeight 84, flex `1 1 220px`); paste handler accepts clipboard images. Images are downscaled to max 1600px long side, JPEG 0.8, white bg, as data URL. Errors: "Please choose an image (screenshot).", "Could not read the image.", "That file is not a readable image.".

### 12.3 CustomDatePicker
Input-like div (`border rounded p-2 bg-white`, height 38px, .9rem, pointer) showing `dd/mm/yyyy` or "Select Date" + `FaCalendarAlt text-muted`. Dropdown (absolute top 100%, mt-1, width 280px, `border rounded shadow-lg bg-white p-3`, z 2050): header row `variant=light sm py-0 px-2 border` `FaChevronLeft`/`FaChevronRight` (12px) around `strong` "{Month} {Year}" .95rem; 7-col grid gap 4px .8rem with `Su Mo Tu We Th Fr Sa` muted bold; day cells `py-1 rounded` height 30 lh 22: today bg `#ffeb3b` black bold border `1px solid #fbc02d`; selected bg `#0d6efd` white bold; hover `#e9ecef`. Footer `text-center mt-2 pt-2 border-top` link "Go to Today" (.75rem `#0d6efd`). Emits `YYYY-MM-DD` (local). Closes on outside mousedown. (`size` prop passed but ignored.)

### 12.4 Password reset (`Common/PasswordResetModal.js`)
`resetPasswordAndCopy(userId,{userName,signOff,withQuickLink})`: `POST /api/users/:id/reset-default-password {}` → `data.temporaryPassword` (else throws `data.message || 'The server did not return the new password.'`); message:
```
Dear *{userName||userId}*,

Your Naqsha Zameen password has been reset.
User ID: *{userId}*
New Password: *{password}*

Quick Login Link:\n{origin}/login?t={btoa({u,p})}   |   Login at: {origin}/login

Please change your password after logging in.

Thanks,
*{signOff || 'GeoMatrix Technologies'}*
```
copied to clipboard. **PasswordCopiedModal** (`modern-modal-compact`, zIndex 20000): title `fas fa-key text-success` "Password reset"; alert success "`fab fa-whatsapp` The new password and a WhatsApp message were **copied to the clipboard**. Paste it into WhatsApp to send it to the customer." (or warning "The clipboard could not be used. Copy the message below."); row "User ID: **{id}**" / "New password: `{pw}`"; textarea rows 9 readOnly (.8rem, select-all on focus); "The new password was also emailed to the customer." if `emailSent`; footer `outline-success sm` "`fab fa-whatsapp` Copy again" (→ "Copied again") + primary "OK".

### 12.5 AccessSection (`.dark-gray-borders`, padding 8; `Row g-2`: `md=5` | `md=7`)
- Left: label "Tehsil"; filter input sm `Filter...`; radio list box (height 120, border, .8rem, bg #fff): `Form.Check type=radio` per tehsil, group entries `🔗` bold `text-primary-emphasis` + `Badge info text-dark .6rem` "Merged Group". Below: "Assigned ({n})" `small fw-bold text-muted`; list (maxHeight 100, flush ListGroup, sorted by name): item `p-1 px-2 .8rem`; if active temp grants: borderLeft `3px solid #f59e0b`, bg `#fffbeb`, name 600, `⏱` (`#f59e0b` .75rem) with tooltip `{d}d {h}h left`; right `.tehsil-action-buttons`: `outline-primary` `FaEdit` and `outline-danger` `FaTrash` (`0 2px`, .45rem; CSS scale .828).
- Right: label "Mouzas" + `.mouza-action-buttons`: `outline-success` "All" (minWidth 55) / `outline-secondary` "None" (65) — CSS: height 26px, `2px 10px`, .78rem 600, radius 4; disabled without tehsil. Filter input sm (ref; refocused after every toggle; disabled w/o tehsil). List box height 260: "Select tehsil" / spinner / rows (assigned first then unassigned, numeric sort): padding `4px 8px`, radius 3, .78rem, bg checked ? (temp ? `#fffbeb` : `#e7f3ff`) : transparent, borderLeft `2px solid #f59e0b` for temp; checkbox readOnly + name (600 if temp); if checked: link icon button 22×22 `FaInfinity` (`#9ca3af`, title "Permanent Access (Click to make Temporary)") → `handleTempGrant(m, 3)`; or `FaClock` (`#d97706`, "Temporary Access (Click to make Permanent)") → removes grant; temp rows also show **TempDaysInput**: number 1–30 (width 38, height 20, .68rem, bg `#fef3c7`, border `#f59e0b`, radius 3, color `#d97706` 600) + "d" suffix; commits on blur/Enter, value = days until `expiresAt` (min 1).
- Toggling a mouza off also removes its temp grant; "None" clears grants for that tehsil. Selecting a tehsil loads its stored mouzas (prevents leakage).

### 12.6 MultiUseSection (`.dark-gray-borders` padding 8; inner `p-2 border rounded bg-light .8rem`)
Header: "Devices used (current activation, 30 days)" + `Badge` (count>3 danger; ==3 warning w/ dark text; else success) "{n} device(s)", + `Badge danger` "Used at the same time" when any `sameTime`. Muted .75rem `fas fa-calendar-alt` "Monitoring since: {activationStart toLocaleDateString || 'N/A'}". Table (`user-list-table m-0 .75rem`, box maxHeight 45vh, radius 6): # / Device (bold; `Badge danger .6rem` "same time") / IP addresses (sessions) (`<code>` ip + `({sessions})` per line, or "{networks} network(s)") / First seen / Last seen (`dd MMM`) / Logins / Sessions / period select (`7 Days|14 Days|30 Days`, default 30; styled .7rem `#007bff` bold border `#ccc` radius 4 width 85 height 20) column with per-row `outline-danger` "Forget" (`0 6px .68rem`) → confirm `Forget "{label}"? It will no longer count towards this account's devices.` → `POST /api/users/:id/devices/:deviceId/forget`. Empty row: "No devices recorded for the selected period." Note box (mt-3 p-2 bg-white border rounded .7rem `#666`): "**Note:** Counted by device (phone / computer), not by IP address, so network changes, flight mode or a new SIM don't add devices. More than 3 devices in 30 days, or two devices used at the same time, usually means the account is shared. Use *Forget* when the customer replaces their phone."

### 12.7 Save (`PUT /api/users/:userId`)
Validation (sets msg danger, tab error, switches tab): `!userName || !mobile` → "Please fill in all required profile fields."; `!startDate || !subscriptionType || !fee` → "Please fill in all required subscription fields."; no assignments → "Assign at least one tehsil and mouzas to the user."; any tehsil with 0 mouzas → `Select at least one mouza for {tehsil}.`.
Payload `{userName, email?, password? (omitted if blank or unchanged), mobileNumber? (omitted if '+92'/empty), startDate, subscriptionType, fee:Number, tehsilAccess:[{tehsil,mouzas,tempGrants}], activeTehsil}`.
Before the request, if subscription (type/startDate) or mouza set changed → WhatsApp text copied silently:
```
Dear *{userName}*,
User ID: *{userId}*

[Your subscription is renewed on *{dd/mm/yyyy}*.
Subscription Details:
- Type: *{type}*
- Total Mouzas: *{n}*
- End Date: *{end dd/mm/yyyy}*
- Days Remaining: *{d}* days[\n\nPlease pay the subscription fee within 1 day to keep using the services.]]
[\n\nYour mouza access has been updated.
- Current Mouzas: *{old}*
- Removed Mouzas: *{list|None}*
- Added Mouzas: *{list|None}*
- Total Mouzas after editing: *{new}*
- Expiry Date: *{end}*]

[- No of devices used in 30 Days: *{n}*\n⚠️ Warning: Using the service on multiple devices violates the terms and your account may be flagged and permanently blocked if not complied with the terms.\n\n]   (ipCount>=5 and not trial)
Thanks,
*{signOff}*
```
After success: if subscription changed and proof present and not hidden → `uploadPaymentProof({kind:'renewal',userId,proof})` (failure → `window.alert("Subscription saved, but the payment proof could not be attached: …")`); `refreshUsers()`; if editing self → `fetchUserProfile()`; close. Error: `errors[].msg` joined / `message` / `error` / `Failed to update: {msg}`.
(`successNotice` modal "Subscription Updated" with WhatsApp textarea exists but is never set → dead.)

---

## 13. User detail page — `/users/:userId` (`UserDetail.js` + `UserDetailTabs`)

**Access**: admin or the user themself. Load `GET /api/users/:userId`; loading → `Container fluid` 60vh centered spinner; error → `Alert danger` "Failed to load user details.".

**Shell** (`UserDetailTabs`): `Container fluid mt-3`; `Button secondary mb-3` "← Back" (`navigate(-1)`); `h3.mb-1` `{userName} ({userId})`; `p.text-muted` `User ID: {id} • {subscriptionType} Subscription`. `.user-detail-tabs-container` (white, radius 8, shadow `0 2px 8px rgba(0,0,0,.1)`). Desktop nav `.tab-navigation.desktop-only` (flex, border-bottom `#e2e8f0`, bg `linear-gradient(to bottom,#f8fafc,#f1f5f9)`, padding `6px 8px 0`, gap 4): `.tab-nav-item` flex 1, padding `.32rem .38rem`, .8rem 600 `#64748b`, radius `6px 6px 0 0`, gap .25rem, icon 1rem; `::after` underline 3px `linear-gradient(90deg,#0ea5e9,#06b6d4)` with shadow `0 -1px 4px rgba(14,165,233,.4)` (0 → 50% hover → 100% active); hover bg `rgba(14,165,233,.05)` color `#0ea5e9`; active color `#0ea5e9` border `#e2e8f0` white bg 700 shadow `0 -2px 8px rgba(0,0,0,.04)`. Mobile `≤768`: wrap, 2 per row (`flex 1 1 calc(50% - 3px)`), `.72rem`, border `#e2e8f0` radius 4, active solid `#0ea5e9` white, no underline; `≤480` `.68rem`. `≤575`: nav hidden, `.tab-navigation-mobile` `Form.Select size=lg` (border `2px solid #00d4ff`, radius 6, padding .75rem, 600, color `#00d4ff`). Panels `.tab-content-panel.active` animate `slideIn .3s`. Later CSS block (`max-width:767px`) also sets `.tab-nav-item` `flex 0 0 auto; min-width 100px; padding .6rem .8rem; .85rem` — overridden by the earlier `!important` 768 rules for padding/font; `min-width:100px` still applies.

Tabs: 👤 Profile, 💳 Subscription, 🔐 Access Control, 📊 Activity, 🕘 History (admin only), 🔐 Login History, 🗺️ Location Map, 🔥 Heatmap. All tab content uses `.responsive-padding` (2rem / 1.5rem ≤991 / 1rem ≤767). Cards use the global dark `.card-header`.

- **ProfileTab (view)**: h4 "Profile Information" (no Edit button since `onEdit` not passed). Two `md=6` cards "Personal Information" (rows User Name, User ID, Mobile Number, Email Address, Registration Date = `startDate toLocaleDateString`) and "Account Status" (Status `Badge` + class `status-badge`: active→success, expired→danger, "expiring soon"→warning, else secondary; Subscription Type; Days Remaining — `text-success` Permanent / `text-danger` if <7 / `{n} days`; Fee `₨ {fee||'N/A'}`). Rows = `ListGroup flush` items flex space-between muted label / strong value.
- **SubscriptionTab (view)**: h4 "Subscription Information". Card "Current Subscription" header with status badge (`bg-success` Active / `bg-danger` Expired / `bg-warning`): rows Subscription Type (text-primary), Start Date, End Date | Days Remaining (`text-success fw-bold` Permanent / `text-danger fw-bold` <7 / `text-success`), Fee (`text-success fw-bold ₨`), Renewals (`renewalCount||0`); `.progress-container` "Subscription Period" / "{p}% elapsed" (.875rem #6c757d), `.progress` 12px radius 6 bg #e9ecef with `.progress-bar bg-{danger≥90|warning≥70|primary}` width p% (CSS bar bg `linear-gradient(90deg,#00d4ff,#0099cc)` + animated stripes). Card "Renewal History": `.timeline` (left line 2px #e9ecef, dots 10px `#00d4ff` with white border + ring) of first 5 entries (date / strong type / `.timeline-badge` `₨ {user.fee}` — shows user fee, not entry amount); >5 → full `Table striped hover sm` (#, Date `toLocaleString`, Type, Fee) in `.responsive-table-wrapper`; empty `.tab-empty-state` 📋 "No Renewal History" / "This user hasn't renewed their subscription yet".
- **AccessControlTab (view)**: h4 "Access Control Information"; empty 🔐 "No Access Assigned"/"This user hasn't been assigned any tehsil or mouza access yet". Left `md=6`: card "Tehsil Access" (Active Tehsil `Badge success`; "Select Tehsil:" `Form.Select sm` with ` (Primary)` / ` (Temporary)` suffixes, disabled when ≤1) and card "All Assigned Tehsils" (items; temp → borderLeft `4px solid #f59e0b` bg `#fffbeb`; `Badge success` "Primary"; `Badge warning text-dark` "Partial Temp Access ({d}d {h}h remaining)" from active `tempGrants`; "{n} mouzas"). Right: card "Mouza Access for {tehsil}": "Select Mouza:" select; `.info-card` "Total Mouzas" (bg #f8f9fa, border #e9ecef, radius 6, padding 1.25rem; title .875rem uppercase #6c757d; value 1.1rem); "All Mouzas:" scroll box (maxHeight 300, bg #f8f9fa) rows `{i}. {mouza}` with `Badge warning text-dark .65rem` "Temp Access ({d}d {h}h)|(Expired)" and bg `#fffbeb` for temp.
- **ActivityTab**: h4 "Activity & Analytics"; card "Usage Overview" with 3 `.metric-card`s (white, border #e9ecef, radius 8, padding 1.25rem, centered; value 2rem 700 `#00d4ff`; label .875rem uppercase #6c757d; sublabel .75rem #adb5bd; hover lift + shadow) for Today / Last 7 Days / Last 30 Days: sessions count, then Total Time / Max / Avg (`{h}h {m}m {s}s`) / IPs. Card "Session Timeline" (+ `badge bg-primary` "{n} Total Sessions"), body maxHeight 500: `Table striped hover sm` sticky thead bg #f8f9fa: # / Start Time / End Time / Duration / IP Address (`<code>`); empty 📊 "No Session Data". Data = `user.sessions[] {start,end,duration (s),ipAddress}`.
- **HistoryTab** (admin): `GET /api/users/:id/history?page&limit=50`; `useProofs({kind:'renewal',userId})`. Card title "Account History" + muted "Every change to this account, kept permanently. Entries marked "migrated" come from the old renewal list."; "Payment proof not matched to a renewal: [📎]" if unlinked proofs. `Table sm hover`: When (`en-PK medium/short`) / Event (`Badge` per TYPE_LABELS: USER_CREATED Created primary; ACTIVATION_SENT/RESENT secondary; ACTIVATED, RENEWED, TIER_UPGRADED (Upgraded), REACTIVATED success; PLAN_CHANGED, ASSIGNMENT_CHANGED (Access changed) info; PROFILE_EDITED, EMAIL_CHANGE_REQUESTED, EMAIL_CHANGED secondary; SUSPENDED, DELETED danger; TRANSFERRED, CORRECTION_APPROVED (Correction), MOUZA_REQUEST_APPROVED (Extra mouzas approved) warning) + `ProofViewButton` (`outline-info py-0 px-1 .72rem` 📎 [count]) / Details (`describe()`: plan transitions `A → B`, `until {date}`, `Rs {amount}` or `Rs {est} (not recorded; user's fee)`, `Added: …`, `Removed: …`, `Changed: fields`, `{from} → {to}`) / By (`migrated` or `{actorId||'system'} ({actorRole})`). Pager "Newer"/"Older" `outline-secondary sm`, "Page x of y".
- **LoginHistoryTab**: `GET /api/users/:id/login-history?days=` (select `Last 7 days|Last 30 days (default)|Last 90 days|Last year|All time` values `7|30|90|365|all`). 4 metric cards (`md=3 sm=6`, value + label + 32px icon opacity .5: Total Logins FaClock primary; Unique IPs FaGlobe info; Locations FaMapMarkerAlt success; Devices Used FaDesktop warning). Card "Recent Login Activity" + `Badge primary` "{n} Recent" (first 10; table Date & Time (`en-US`) / IP / Location (`FaMapMarkerAlt` city, country or "Unknown") / Device (`<strong>{browser}</strong> on {os}` + small device) / Status `Badge success/danger` Success/Failed); empty 🔐 "No Login History". Card "IP Address Statistics" + `Badge secondary` "{n} IPs": IP / Login Count (`Badge info`) / Location / First Seen / Last Seen / Devices (`Badge secondary`); empty 📊 "No IP Data". UA parse: Chrome/Firefox/Safari/Edge; Windows/macOS/Linux/Android/iOS; Mobile/Tablet/Desktop.
- **LocationMapTab**: same endpoint (no days), logins with lat/lng, Leaflet OSM map 500px radius 8 (custom numbered teardrop markers `linear-gradient(135deg,#667eea,#764ba2)`, selected `#764ba2→#f093fb` 32px, white 3px border); `FitBounds` padding 50 maxZoom 15; default center `30.3753,69.3451`. Suspicious travel `Alert warning` ("Suspicious Travel Detected", `• {cityA} → {cityB}: {dist} in {min} minutes ({km/h} km/h)` + reason). 4 metric cards: Unique Locations / Total Logins / Countries / Total Distance. Card "All Login Locations" `ListGroup action` items (city, region; country; `📍 Lat: … Lng: …`; "Last login: …"; badges `{n} logins` primary, `{n} IP(s)` secondary; selected → `active` + IP list). Loading: spinner + "Loading location data...". Empty `Alert info` "No location data available for this user's logins."
- **HeatmapTab**: same endpoint; `leaflet.heat` layer (radius 25, blur 15, maxZoom 17) 400px, default center `30.0444,71.5312`; metric cards Heat Zones (FaMapMarkedAlt primary) / Total Activities (FaFire danger) / Simultaneous Logins (FaExclamationTriangle warning); card "🔥 Activity Intensity by Location" list with 12px colored dot + glow (ratio >.7 `#d32f2f`, >.4 `#f57c00`, >.2 `#fbc02d`, else `#7cb342`), coords 2 dp, IPs, `Badge light text-dark` borderLeft 4px colored "{n} logins"; card header `bg-warning text-dark` "Suspicious Activity: Simultaneous Logins from Different IPs" (pairs within 5 min from different IPs; `Badge danger` "{s}s apart|{m}m apart"). Empty `Alert info` "No login data available to generate heatmap."

---

## 14. Dead `UserManagement/*` (not routed; summary only)
- **BulkOperations**: client-side filtered table with checkboxes; buttons Reset Passwords (warning) / Update Subscriptions (info) / Delete Selected (danger); compact confirm modal with ProgressBar; endpoints `DELETE /api/users/:id`, `POST /api/users/:id/reset-default-password`, `POST /api/users/:id/update-subscription {subscriptionType}`, `POST /api/users/:id/extend-subscription {days}`; subscription options list includes non-canonical `Biannual (180 days)` / `Annual (365 days)`; description text still says password reset to `'aaaaaa'` (obsolete).
- **UserActions**: left "Select User" list + right cards Edit User / Reset Password / Create Demo Link / Login As User + "Danger Zone" delete; uses `resetPasswordAndCopy`, `loginAs`, demo-links.
- **UserDetails**: 4 colored-header cards (`bg-primary`, `bg-success`, `bg-info`, `bg-secondary`) calling non-existent `${API}/user-sessions/:id` and `/user-locations/:id`.

---

## 15. CSS quick reference not covered above
- `action-buttons.css`: `.action-buttons .btn, .subscription-buttons .btn` → transparent bg, `border:1px solid !important`, no shadow, padding `.28rem !important`, `aspect-ratio 1/1`, `transform: scale(0.81)`; svg `1.2em`; hover svg `scale(1.2)`; colours: outline-primary `#0d6efd`, info `#0dcaf0`, warning `#ffc107`, secondary `#6c757d`, success `#198754`, danger `#dc3545`. `.tehsil-action-buttons .btn` padding `.15rem .35rem`, `scale(.828)`, svg 1.1em .9rem. `.mouza-action-buttons .btn` see §12.5. Note `userlist.css` also defines `.action-buttons .btn {padding .25rem .5rem; font .68rem; radius 6px}` — action-buttons.css is imported first (App.js) so userlist.css wins on padding where not `!important`… but action-buttons uses `!important` on padding → `.28rem` wins.
- `subscription-buttons.css`: `.subscription-buttons .btn` padding `.375rem .75rem`, radius 6, 600, minWidth 50; outline colours info `#0dcaf0`, primary `#0d6efd`, success `#198754`, warning `#ffc107`, danger `#dc3545` with 10% hover bg; mobile column/full width. (No markup currently uses it.)
- `profile.css`: `.profile-container` (navbar avatar, height 51px), `.profile-status-indicator` 8px `#00ff00` dot, `.username` #e4e7eb .875rem max 150px; **global** `.modal-footer` flex-end gap 10 padding 10, `.modal-footer .btn` padding `6px 12px` .85rem radius 6; `.modal-footer .btn-danger` `#dc3545` hover `#bd2130` scale 1.05; mobile footer centered, btn `4px 8px .7rem`.
- `global.css` `.input-clear-btn-red`: absolute right 14px, 22px circle, bg `rgba(239,68,68,.12)`, border `rgba(239,68,68,.35)`, `#ef4444`, .75rem 800; hover solid red + glow `0 0 8px rgba(239,68,68,.4)` + `scale(1.12)`. `userlist.css` redefines it with right 10px (loaded later → wins). UserList's inline styles override bg/border/position anyway.
- `tabs.css` `.status-badge` (unused variants): radius 20px, `.35rem .75rem`, .85rem 600 uppercase; `.active` `#d1e7dd/#0f5132`, `.expired` `#f8d7da/#842029`, `.expiring` `#fff3cd/#997404`, `.suspended` `#e2e3e5/#41464b`.

---

## 16. Gotchas the rebuild must preserve (or consciously fix)

1. **`.btn-primary` is `#0096c7`** app-wide via form.css, but several components hard-code `#0d6efd` (ResetPassword submit, Login links/forgot link, date picker selected day). Reproduce both.
2. **Global `.card-header` is the dark navy gradient with `#00ffff` text** (form.css). Public registration section headers, UserDetail tab cards and ProfileTab/SubscriptionTab cards all inherit it; UserRegistration overrides inline.
3. Login `?t=` quick-login token is plain base64 JSON `{u,p}` containing the password; also generated client-side by UserRegistration and Quick Login reset.
4. Login "Forgot Password?" posts to `/api/forgot-password`; ForgotPasswordModal posts to `/forgot-password` (no `/api`). VerifyEmail retries `/verify-email` without `/api` on failure.
5. ResetPassword logs out ALL sessions and clears cookies on mount; placeholder says "Min. 8 characters" but validation is 6; auto-redirects 2 s after success with `focusPassword`.
6. Public registration: Turnstile code exists but `ENABLE_TURNSTILE=false`; limit 1 tehsil / 1 mouza enforced client-side with a modal; `userId` regex `^[a-zA-Z0-9._-]+$`, min 3; password rule 6+/upper/lower/special; live `check-userid` debounce 500 ms; `startDate` sent as local ISO date; `deviceId` sent; credentials saved to `sessionStorage.pending_activation_creds` to prefill login after email verification; `tehsilInputRef` never attached (focus no-op).
7. Admin registration auto-generates password `Name@12345` from name + last 5 mobile digits on every change (overwrites manual password); min length 8 (no complexity); copies credentials + quick link to clipboard; "mouzas loading completed" info modal auto-closes after 1 s; AKAR tehsils included for admin only.
8. Status row colours in UserList rely on CSS vars from tokens.css + solid overrides for the frozen column (`#d1e7dd/#fff3cd/#f8d7da/#ffe8cc`). Row class logic: `Active`→active, `Pending`→pending, `0<days<=7`→expiring, else expired (even for Trial etc.).
9. UserList fetch is server-driven: tab/sort/filters are query params; AbortController cancels in-flight requests (race fix); `usersPerPage=50`; "Select all matching" loops pages with limit 100 (cap 100 pages); bulk assign sends chunks of 500.
10. UserList row click opens the edit modal — there are no per-row action buttons anymore (the dead handlers and `action-buttons`/`subscription-buttons` CSS are leftovers).
11. `?activateUserId=` opens UserEditForm on the Subscription tab and immediately rewrites the URL to `/users`.
12. UserEditForm: all Profile fields locked behind pencil toggles; admin sees password in clear (`type=text`), "Hashed" tag when hashed; password omitted from PUT when blank or unchanged; mobile omitted when `'+92'`; email omitted when blank. End date/status recomputed on the client (GMT+5 math) and the UI's "Pending" status is preserved.
13. UserEditForm silently copies a WhatsApp message to the clipboard on save whenever subscription or mouzas changed (sign-off differs for sub-admins); device-count warning appended when `ipMisuse.count30 >= 5`.
14. Temporary mouza grants: clock/infinity toggle, default 3 days, 1–30 day input, `tempGrants[{mouza,expiresAt}]` sent per tehsil; unchecking removes the grant.
15. `localStorage geo_known_mouzas_{user}_{tehsil}` keeps de-assigned mouzas visible as options forever.
16. Mouza change requests: three admin UIs depending on `invoicesEnabled` from API and request status; rounding up to Rs 50; invoice due in 3 days; approve/confirm closes the modal with `alert()`.
17. Payment proof: optional, image compressed client-side to ≤1600px JPEG 0.8 as data URL; hidden for Trial or already-expired date ranges; "Attach to last renewal" never creates a renewal.
18. Subscription warning modal: Easypaisa/JazzCash numbers come from `/api/profile` `provider`; fallback hard-coded `03146796144 / Muhammad Masoom`; WhatsApp fallback `923048840264`; **no prices are ever displayed** (only account numbers and "A small fee may apply" in ChangeMouzas). Warning thresholds: Pending/Expired → payment; ≤5 days → expiring-soon; admins exempt; suppressed on `/login`, `/activate/*`, `/subadmin/activate/*`, `/confirm-email/*` and while the IP-misuse modal (>3 devices) is open.
19. ProfileModal "Change Password" button is wired to state nothing consumes (no change-password UI reachable). `ChangePasswordForm.js`, `EditProfileForm.js` (the only react-input-mask usage: `399 9999999`), root `ResetPassword.js`/`DemoAccess.js`, `UserManagement/*`, `user-management.css`, `table.css`, `tempAccess.css` are dead; `form-fixes.css` is empty.
20. `RegistrationGuidanceModal` "Forgot Password?" navigates with `state.openForgotPassword` which Login ignores.
21. `modern-modal-compact` forces max-width 315px and header font .85rem via `!important` — inline title sizes in components (e.g. 1rem) do not take effect; `subscription-warning-dialog` narrows to 300px.
22. The UserDetail tab bar has conflicting mobile rules (`≤768` !important vs `≤767` plain); net effect on phones: 2-per-row wrapped buttons, `.72rem`, `min-width:100px`, solid `#0ea5e9` active. Below 576px the bar is replaced by a cyan-bordered select.
23. Date formatting mixes locales: UserList `en-GB`, LoginHistory/LocationMap `en-US`, History `en-PK`, ProfileTab `toLocaleDateString()` default.
24. `calculateDaysRemaining` returns `99999` for Permanent; ProfileModal shows "99999 days" for permanent users.
25. UserRegistration summary cards contain lowercase inline style keys (`justifycontent`, `alignitems`, `minwidth`) that React ignores — the row is not space-between; match the visual (name block followed immediately by icon buttons).
