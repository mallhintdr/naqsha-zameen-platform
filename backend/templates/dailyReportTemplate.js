/**
 * dailyReportTemplate.js
 *
 * Builds the HTML that Puppeteer renders to PDF for the daily admin report.
 * Colors are taken directly from public/GeoMatrix Logo.png (navy + lime).
 */
const BRAND_NAVY = '#1b3a5c';
const BRAND_NAVY_DARK = '#12293f';
const BRAND_LIME = '#8dc63f';
const BRAND_GRAY = '#64748b';

const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-PK')}`;
const changeBadge = (pct) => {
    const up = pct >= 0;
    const color = up ? '#15803d' : '#b91c1c';
    const bg = up ? '#dcfce7' : '#fee2e2';
    const arrow = up ? '▲' : '▼';
    return `<span style="color:${color};background:${bg};border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;">${arrow} ${Math.abs(pct)}%</span>`;
};

function kpiTile(label, value, accent = BRAND_NAVY) {
    return `
    <div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-left:4px solid ${accent};border-radius:8px;padding:12px 14px;">
      <div style="font-size:11px;color:${BRAND_GRAY};text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${BRAND_NAVY_DARK};margin-top:4px;">${value}</div>
    </div>`;
}

function userTable(rows, columns, truncatedBy = 0) {
    if (!rows || rows.length === 0) {
        return `<div style="padding:14px;color:${BRAND_GRAY};font-size:12px;font-style:italic;background:#f8fafc;border-radius:6px;">No records for this period.</div>`;
    }
    const head = columns.map(c => `<th style="text-align:left;padding:6px 8px;background:${BRAND_NAVY};color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;">${c.label}</th>`).join('');
    const body = rows.map((r, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        ${columns.map(c => `<td style="padding:6px 8px;font-size:12px;color:#1e293b;border-bottom:1px solid #eef2f7;">${c.render ? c.render(r) : (r[c.key] ?? '')}</td>`).join('')}
      </tr>`).join('');
    const note = truncatedBy > 0
        ? `<div style="padding:6px 8px;font-size:11px;color:${BRAND_GRAY};font-style:italic;">…and ${truncatedBy} more not shown (list truncated).</div>`
        : '';
    return `<table style="width:100%;border-collapse:collapse;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${note}`;
}

function buildReportHtml(data, chartImages, logoBase64) {
    const { reportDate, generatedAt, kpis, revenue, subscriptionHealth, topTehsils, newRegistrationsList, renewalsList, expiredList, insights, trendDays, listTruncation } = data;
    const trunc = listTruncation || {};

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; color: #1e293b; }
  .page { padding: 28px 34px; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .letterhead { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid ${BRAND_LIME}; padding-bottom:14px; margin-bottom:18px; }
  .letterhead img { height:56px; }
  .letterhead .title { text-align:right; }
  .letterhead .title h1 { margin:0; font-size:18px; color:${BRAND_NAVY_DARK}; }
  .letterhead .title div { font-size:11px; color:${BRAND_GRAY}; margin-top:2px; }
  .section-title { font-size:13px; font-weight:800; color:${BRAND_NAVY}; text-transform:uppercase; letter-spacing:0.05em; margin: 18px 0 8px; border-left:4px solid ${BRAND_LIME}; padding-left:8px; }
  .kpi-row { display:flex; gap:10px; }
  .chart-box { border:1px solid #e2e8f0; border-radius:8px; padding:6px; margin-bottom:12px; }
  .chart-box img { width:100%; display:block; }
  .footer-note { margin-top:24px; font-size:10px; color:${BRAND_GRAY}; text-align:center; }
  .insight-list { margin:0; padding-left:18px; font-size:12.5px; line-height:1.7; }
</style>
</head>
<body>

  <!-- PAGE 1: Letterhead + KPIs + Revenue -->
  <div class="page">
    <div class="letterhead">
      ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="GeoMatrix" />` : ''}
      <div class="title">
        <h1>Naqsha Zameen — Operations Report</h1>
        <div>Period: ${reportDate} &nbsp;·&nbsp; Generated: ${generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC</div>
        <div>Confidential — Admin Only</div>
      </div>
    </div>

    <div class="kpi-row">
      ${kpiTile('Active Users', kpis.activeUsers)}
      ${kpiTile('New Registrations', kpis.newRegistrationsToday, BRAND_LIME)}
      ${kpiTile('Renewals', kpis.renewalsToday, BRAND_LIME)}
      ${kpiTile('Expired', kpis.expiredToday, '#dc3545')}
      ${kpiTile('Revenue', money(kpis.revenueToday), BRAND_NAVY)}
    </div>

    <div class="section-title">Revenue Summary</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="background:${BRAND_NAVY};color:#fff;">
        <th style="text-align:left;padding:8px;font-size:11px;">Period</th>
        <th style="text-align:right;padding:8px;font-size:11px;">Amount</th>
        <th style="text-align:right;padding:8px;font-size:11px;">Change vs. Prior Equivalent Period</th>
      </tr>
      <tr style="background:#f8fafc;"><td style="padding:8px;font-size:12.5px;">${reportDate}</td><td style="padding:8px;text-align:right;font-weight:700;">${money(revenue.today)}</td><td style="padding:8px;text-align:right;">${changeBadge(revenue.todayChangePct)}</td></tr>
      <tr><td style="padding:8px;font-size:12.5px;">Prior Equivalent Period</td><td style="padding:8px;text-align:right;font-weight:700;">${money(revenue.priorPeriodTotal)}</td><td style="padding:8px;text-align:right;">—</td></tr>
    </table>

    <div class="section-title">Revenue Trend (${trendDays} Day${trendDays === 1 ? '' : 's'})</div>
    <div class="chart-box"><img src="data:image/png;base64,${chartImages.revenue}" /></div>
  </div>

  <!-- PAGE 2: Growth + Health -->
  <div class="page">
    <div class="section-title">Registrations Trend (${trendDays} Day${trendDays === 1 ? '' : 's'})</div>
    <div class="chart-box"><img src="data:image/png;base64,${chartImages.registrations}" /></div>

    <div style="display:flex;gap:14px;">
      <div style="flex:1;">
        <div class="section-title">Subscription Health</div>
        <div class="chart-box"><img src="data:image/png;base64,${chartImages.health}" /></div>
      </div>
      <div style="flex:1;">
        <div class="section-title">Top Tehsils</div>
        <div class="chart-box"><img src="data:image/png;base64,${chartImages.tehsils}" /></div>
      </div>
    </div>

    <div class="section-title">Insights</div>
    <ul class="insight-list">
      ${insights.map(i => `<li>${i}</li>`).join('')}
    </ul>
  </div>

  <!-- PAGE 3: Detail tables -->
  <div class="page">
    <div class="section-title">New Registrations (${kpis.newRegistrationsToday})</div>
    ${userTable(newRegistrationsList, [
        { label: 'User ID', key: 'userId' },
        { label: 'Name', key: 'userName' },
        { label: 'Tehsil', key: 'activeTehsil' },
        { label: 'Plan', key: 'subscriptionType' },
        { label: 'Source', key: 'registrationSource' }
    ], trunc.registrationsTruncated)}

    <div class="section-title">Renewals (${kpis.renewalsToday})</div>
    ${userTable(renewalsList, [
        { label: 'User ID', key: 'userId' },
        { label: 'Name', key: 'userName' },
        { label: 'Previous Plan', key: 'previousType' },
        { label: 'New Plan', key: 'newType' },
        { label: 'Amount', render: (r) => money(r.amount) }
    ], trunc.renewalsTruncated)}

    <div class="section-title">Expired (${kpis.expiredToday})</div>
    ${userTable(expiredList, [
        { label: 'User ID', key: 'userId' },
        { label: 'Name', key: 'userName' },
        { label: 'Tehsil', key: 'activeTehsil' },
        { label: 'Plan', key: 'subscriptionType' },
        { label: 'Mobile', key: 'mobileNumber' }
    ], trunc.expiredTruncated)}

    <div class="footer-note">Generated automatically by GeoMatrix Technologies &mdash; Naqsha Zameen Admin Reporting</div>
  </div>

</body>
</html>`;
}

module.exports = { buildReportHtml };
