import { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, Filler, DoughnutController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';

// Chart.js (MIT). Only the pieces we use are registered to keep the bundle small.
Chart.register(BarController, BarElement, LineController, LineElement, PointElement, Filler, DoughnutController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend);
Chart.defaults.font.family = '"Inter Variable", "Segoe UI", system-ui, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = '#64748b';

export const PALETTE = { steel: '#2563eb', sky: '#93c5fd', pale: '#dbeafe', ok: '#16a34a', warn: '#d97706', risk: '#dc2626', slate: '#94a3b8', violet: '#7c3aed', cyan: '#0891b2' };
const TOOLTIP = { backgroundColor: '#0f172a', padding: 10, cornerRadius: 8, titleFont: { weight: '600' }, boxPadding: 4 };
const GRID = '#eef2f7';

function HiddenTable({ label, labels, series }) {
  return (
    <table className="visually-hidden"><caption>{label}</caption>
      <thead><tr><th scope="col">Category</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
      <tbody>{labels.map((l, i) => <tr key={l + i}><th scope="row">{l}</th>{series.map((s) => <td key={s.name}>{s.data[i]}</td>)}</tr>)}</tbody></table>
  );
}

/**
 * Bar/column chart. `series`: [{ name, data: number[], color?, colors?: string[] (per bar) }].
 * Canvas charts are invisible to screen readers, so the same numbers are rendered as a hidden table.
 */
export function BarChart({ labels, series, horizontal = false, stacked = false, height = 260, label, axisTitle, max, legend = true }) {
  const ref = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    const valueAxis = { stacked, beginAtZero: true, max, grid: { color: GRID }, border: { display: false }, title: { display: Boolean(axisTitle), text: axisTitle }, ticks: { precision: 0 } };
    const catAxis = { stacked, grid: { display: false }, border: { color: '#e2e8f0' } };
    chart.current = new Chart(ref.current, {
      type: 'bar',
      data: { labels, datasets: series.map((s, i) => ({ label: s.name, data: s.data, backgroundColor: s.colors || s.color || Object.values(PALETTE)[i % 7], borderRadius: 4, borderSkipped: false, maxBarThickness: 28 })) },
      options: {
        indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
        plugins: { legend: { display: legend && series.length > 1, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } }, tooltip: TOOLTIP },
      },
    });
    return () => chart.current?.destroy();
  }, [JSON.stringify({ labels, series, horizontal, stacked, max, axisTitle, legend })]);
  return (
    <figure className="m-0">
      <div style={{ position: 'relative', height }}><canvas ref={ref} role="img" aria-label={label} /></div>
      <HiddenTable label={label} labels={labels} series={series} />
    </figure>
  );
}

/** Line/area trend chart, e.g. tickets created vs resolved per day. */
export function LineChart({ labels, series, height = 240, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = new Chart(ref.current, {
      type: 'line',
      data: { labels, datasets: series.map((s, i) => {
        const color = s.color || Object.values(PALETTE)[i % 7];
        return { label: s.name, data: s.data, borderColor: color, backgroundColor: `${color}1f`, fill: i === 0, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 };
      }) },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, interaction: { mode: 'index', intersect: false },
        scales: { x: { grid: { display: false }, border: { color: '#e2e8f0' }, ticks: { maxTicksLimit: 7 } }, y: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { precision: 0 } } },
        plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true } }, tooltip: TOOLTIP },
      },
    });
    return () => c.destroy();
  }, [JSON.stringify({ labels, series })]);
  return (
    <figure className="m-0">
      <div style={{ position: 'relative', height }}><canvas ref={ref} role="img" aria-label={label} /></div>
      <HiddenTable label={label} labels={labels} series={series} />
    </figure>
  );
}

/** Doughnut with a centred total. `items`: [{ name, value, color }]. */
export function Donut({ items, label, height = 180, centerLabel }) {
  const ref = useRef(null);
  const total = items.reduce((s, i) => s + i.value, 0);
  useEffect(() => {
    const c = new Chart(ref.current, {
      type: 'doughnut',
      data: { labels: items.map((i) => i.name), datasets: [{ data: items.map((i) => i.value), backgroundColor: items.map((i) => i.color), borderWidth: 2, borderColor: '#fff', hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '72%', animation: { duration: 250 }, plugins: { legend: { display: false }, tooltip: TOOLTIP } },
    });
    return () => c.destroy();
  }, [JSON.stringify(items)]);
  return (
    <figure className="m-0 d-flex align-items-center gap-3">
      <div style={{ position: 'relative', height, width: height, flexShrink: 0 }}>
        <canvas ref={ref} role="img" aria-label={label} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div className="fw-bold num" style={{ fontSize: '1.5rem', lineHeight: 1 }}>{total}</div><div className="small text-muted">{centerLabel}</div>
        </div>
      </div>
      <ul className="list-unstyled m-0 small flex-grow-1">{items.map((i) => <li key={i.name} className="d-flex align-items-center gap-2 py-1"><span style={{ width: 9, height: 9, borderRadius: 2, background: i.color, display: 'inline-block' }} /><span className="flex-grow-1 text-muted">{i.name}</span><strong className="num">{i.value}</strong></li>)}</ul>
      <HiddenTable label={label} labels={items.map((i) => i.name)} series={[{ name: 'Count', data: items.map((i) => i.value) }]} />
    </figure>
  );
}
