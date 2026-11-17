import { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';

// Chart.js (MIT). Only the pieces we use are registered to keep the bundle small.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);
Chart.defaults.font.family = '"Plus Jakarta Sans Variable", "Segoe UI", system-ui, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = '#657386';

export const PALETTE = { steel: '#7950f2', sky: '#91a7ff', pale: '#e5dbff', ok: '#40c057', warn: '#fab005', risk: '#fa5252', slate: '#adb5bd' };

/**
 * Bar/column chart. `series`: [{ name, data: number[], color?, colors?: string[] (per bar) }].
 * Canvas charts are invisible to screen readers, so the same numbers are rendered as a hidden table.
 */
export function BarChart({ labels, series, horizontal = false, stacked = false, height = 260, label, axisTitle, max, legend = true }) {
  const ref = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    const valueAxis = { stacked, beginAtZero: true, max, grid: { color: '#f3f1ed' }, border: { display: false }, title: { display: Boolean(axisTitle), text: axisTitle }, ticks: { precision: 0 } };
    const catAxis = { stacked, grid: { display: false } };
    chart.current = new Chart(ref.current, {
      type: 'bar',
      data: { labels, datasets: series.map((s, i) => ({ label: s.name, data: s.data, backgroundColor: s.colors || s.color || Object.values(PALETTE)[i % 7], borderRadius: 8, borderSkipped: false, maxBarThickness: 30 })) },
      options: {
        indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
        plugins: { legend: { display: legend && series.length > 1, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: { backgroundColor: '#2b2a33', padding: 10, cornerRadius: 10 } },
      },
    });
    return () => chart.current?.destroy();
  }, [JSON.stringify({ labels, series, horizontal, stacked, max, axisTitle, legend })]);
  return (
    <figure className="m-0">
      <div style={{ position: 'relative', height }}><canvas ref={ref} role="img" aria-label={label} /></div>
      <table className="visually-hidden"><caption>{label}</caption>
        <thead><tr><th scope="col">Category</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
        <tbody>{labels.map((l, i) => <tr key={l + i}><th scope="row">{l}</th>{series.map((s) => <td key={s.name}>{s.data[i]}</td>)}</tr>)}</tbody></table>
    </figure>
  );
}
