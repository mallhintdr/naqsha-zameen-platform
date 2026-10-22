/**
 * chartRenderer.js
 *
 * Pre-rasterizes Chart.js charts to PNG buffers server-side, so the report's
 * HTML template just embeds plain <img> tags — no client-side JS/animation
 * for Puppeteer to wait on.
 *
 * Uses @napi-rs/canvas (prebuilt native binaries, no node-gyp/compiler
 * required on any platform) directly with chart.js, rather than going
 * through chartjs-node-canvas — that package hard-depends on the `canvas`
 * npm package, which has no prebuilt binary for current Node versions on
 * Windows and falls back to a native compile that's fragile in practice
 * (confirmed: it failed here). @napi-rs/canvas implements the same
 * Canvas/CanvasRenderingContext2D surface Chart.js needs, so it's a drop-in
 * 2D context source without any compilation step.
 */
const { createCanvas } = require('@napi-rs/canvas');
const { Chart, registerables } = require('chart.js');

Chart.register(...registerables);

const BRAND_NAVY = '#1b3a5c';
const BRAND_NAVY_LIGHT = '#3d6a94';
const BRAND_LIME = '#8dc63f';
const BRAND_GRAY = '#94a3b8';
const BRAND_RED = '#dc3545';

const WIDTH = 900;
const HEIGHT = 420;

/** Renders one Chart.js config to a PNG buffer via an offscreen napi-rs canvas. */
function renderChartToBuffer(config, width = WIDTH, height = HEIGHT) {
    const canvas = createCanvas(width, height);
    // Chart.js reads canvas.width/height directly; @napi-rs/canvas's context
    // implements the 2D API Chart.js draws with (fillRect, arc, bezier, etc.).
    const chart = new Chart(canvas, {
        ...config,
        options: {
            ...(config.options || {}),
            responsive: false,
            animation: false,
            devicePixelRatio: 1
        }
    });
    const buffer = canvas.toBuffer('image/png');
    chart.destroy();
    return buffer;
}

async function renderRevenueTrendChart(trend30d) {
    return renderChartToBuffer({
        type: 'line',
        data: {
            labels: trend30d.map(d => d.date.slice(5)), // MM-DD
            datasets: [{
                label: 'Daily Revenue (Rs.)',
                data: trend30d.map(d => d.amount),
                borderColor: BRAND_NAVY,
                backgroundColor: 'rgba(27, 58, 92, 0.12)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
                borderWidth: 2
            }]
        },
        options: {
            plugins: { legend: { display: false }, title: { display: true, text: '30-Day Revenue Trend' } },
            scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true } }
        }
    });
}

async function renderRegistrationsTrendChart(trend30d) {
    return renderChartToBuffer({
        type: 'bar',
        data: {
            labels: trend30d.map(d => d.date.slice(5)),
            datasets: [
                {
                    label: 'Public Registrations',
                    data: trend30d.map(d => d.publicCount),
                    backgroundColor: BRAND_LIME
                },
                {
                    label: 'Admin-Created',
                    data: trend30d.map(d => Math.max(0, d.count - d.publicCount)),
                    backgroundColor: BRAND_NAVY_LIGHT
                }
            ]
        },
        options: {
            plugins: { legend: { position: 'top' }, title: { display: true, text: '30-Day Registrations Trend' } },
            scales: { x: { stacked: true, ticks: { maxTicksLimit: 10 } }, y: { stacked: true, beginAtZero: true } }
        }
    });
}

async function renderSubscriptionHealthDonut(health) {
    return renderChartToBuffer({
        type: 'doughnut',
        data: {
            labels: ['Active', 'Expired', 'Pending', 'Expiring ≤ 5d'],
            datasets: [{
                data: [health.active, health.expired, health.pending, health.expiringSoon],
                backgroundColor: [BRAND_LIME, BRAND_RED, BRAND_GRAY, '#f59e0b']
            }]
        },
        options: {
            plugins: { legend: { position: 'right' }, title: { display: true, text: 'Subscription Health' } }
        }
    });
}

async function renderTopTehsilsChart(topTehsils) {
    return renderChartToBuffer({
        type: 'bar',
        data: {
            labels: topTehsils.map(t => t.tehsil),
            datasets: [{
                label: 'Active Users',
                data: topTehsils.map(t => t.userCount),
                backgroundColor: BRAND_NAVY
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: { legend: { display: false }, title: { display: true, text: 'Top Tehsils by Active Users' } },
            scales: { x: { beginAtZero: true } }
        }
    });
}

module.exports = {
    renderRevenueTrendChart,
    renderRegistrationsTrendChart,
    renderSubscriptionHealthDonut,
    renderTopTehsilsChart
};
