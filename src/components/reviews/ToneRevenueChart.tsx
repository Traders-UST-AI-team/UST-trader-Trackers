import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { useChartTheme } from '../useChartTheme';
import type { QuarterlyAggregation } from '../../../shared/review-types';
import { SIGNALS } from '../../../shared/review-signals';

interface ToneRevenueChartProps {
  quarters: QuarterlyAggregation[];
  productTitle: string;
}

export function ToneRevenueChart({ quarters, productTitle }: ToneRevenueChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const themeVersion = useChartTheme();

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);

    const isDark =
      document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const textColor = isDark ? '#e7e9eb' : '#111315';
    const subtextColor = isDark ? '#aeb5bc' : '#5a626a';
    const gridColor = isDark ? '#252b31' : '#e6e7e0';
    const surfaceColor = isDark ? '#171b1f' : '#ffffff';

    const labels = quarters.map((q) => q.quarter_label || q.calendar_quarter);
    const avgTones = quarters.map((q) => q.avg_tone);
    const baselineTones = quarters.map((q) => q.baseline_tone);
    const redditTones = quarters.map((q) => q.reddit_tone);
    const revenueYoYs = quarters.map((q) => q.financial?.revenue_yoy_growth ?? null);

    // Delta Tone bars with custom item styles
    const deltaBarData = quarters.map((q) => {
      const val = q.delta_tone;
      if (val === null) return null;
      let color = '#3fbf7a'; // Green
      if (val < SIGNALS.negativeSwingDelta) {
        color = '#dc2626'; // Bold crimson alert
      } else if (val < 0) {
        color = '#f97316'; // Warning orange
      }
      return {
        value: val,
        itemStyle: {
          color,
          borderRadius: val >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4],
        },
      };
    });

    // MarkPoints for negative swings and misses
    const markPointsData: any[] = [];
    quarters.forEach((q, idx) => {
      if (q.is_miss) {
        markPointsData.push({
          name: 'Revenue Miss',
          coord: [idx, q.delta_tone ?? 0],
          value: 'Miss',
          symbol: 'pin',
          symbolSize: 40,
          itemStyle: { color: '#dc2626' },
        });
      } else if (q.is_negative_swing) {
        markPointsData.push({
          name: 'Negative Swing',
          coord: [idx, q.delta_tone ?? 0],
          value: '⚠️ Swing',
          symbol: 'roundRect',
          symbolSize: [56, 22],
          itemStyle: { color: '#ef4444' },
          label: { fontSize: 10, color: '#fff' },
        });
      }
    });

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      title: {
        text: `${productTitle} · Tone vs. SEC Revenue YoY`,
        subtext: `Dual-axis model · a negative swing (delta tone below ${SIGNALS.negativeSwingDelta}) is a candidate lead indicator, not a prediction`,
        left: 12,
        top: 8,
        textStyle: { color: textColor, fontSize: 14, fontWeight: 600 },
        subtextStyle: { color: subtextColor, fontSize: 11 },
      },
      legend: {
        top: 10,
        right: 12,
        textStyle: { color: textColor, fontSize: 11 },
        data: [
          'Quarterly Avg Tone',
          '4Q Rolling Baseline',
          'Delta Tone (Deviation)',
          'Reddit Canary Tone',
          'SEC Revenue YoY (%)',
        ],
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: subtextColor, type: 'dashed' } },
        backgroundColor: surfaceColor,
        borderColor: gridColor,
        textStyle: { color: textColor, fontSize: 12 },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const idx = params[0].dataIndex;
          const q = quarters[idx];
          if (!q) return '';

          const sparseNote = q.is_sparse ? `<span style="color:#f59e0b;font-weight:bold;"> [⚠️ Sparse N&lt;${SIGNALS.sparseReviewCount}]</span>` : '';
          const swingNote = q.is_negative_swing ? `<br/><span style="color:#ef4444;font-weight:bold;">⚠️ Negative swing: delta tone &lt; ${SIGNALS.negativeSwingDelta}</span>` : '';
          // is_miss means the tone swung while reported revenue was still growing: a divergence to
          // watch, not a confirmed miss. The old label asserted the opposite of the flag.
          const missNote = q.is_miss ? '<br/><span style="color:#dc2626;font-weight:bold;">📉 Tone fell while revenue still grew (divergence, not a confirmed miss)</span>' : '';

          let finHtml = '<em>No SEC 10-Q filing</em>';
          if (q.financial) {
            finHtml = `<b>${q.financial.revenue_yoy_growth != null ? `${q.financial.revenue_yoy_growth > 0 ? '+' : ''}${q.financial.revenue_yoy_growth}%` : 'N/A'}</b> (Rev: $${q.financial.revenue_usd ? (q.financial.revenue_usd / 1e6).toFixed(0) : '?'}M)`;
          }

          return `
            <div style="font-family:inherit;min-width:240px;line-height:1.5;">
              <div style="border-bottom:1px solid ${gridColor};padding-bottom:4px;margin-bottom:6px;font-weight:600;">
                ${q.quarter_label} (${q.calendar_quarter}) ${sparseNote}
              </div>
              <div style="font-size:11.5px;">
                <div>📦 Review Count: <b>${q.review_count}</b></div>
                <div>💬 Avg Tone Score: <b>${q.avg_tone ?? 'N/A'}</b> / +2.0</div>
                <div>📊 4Q Baseline Tone: <b>${q.baseline_tone ?? 'N/A'}</b></div>
                <div>⚡ Delta Tone: <b style="color:${(q.delta_tone ?? 0) < SIGNALS.negativeSwingDelta ? '#ef4444' : (q.delta_tone ?? 0) < 0 ? '#f59e0b' : '#10b981'};">${q.delta_tone ?? 'N/A'}</b></div>
                <div>🛡️ Reddit Canary: <b>${q.reddit_tone ?? 'N/A'}</b></div>
                <div style="margin-top:4px;border-top:1px dashed ${gridColor};padding-top:4px;">
                  🏛️ SEC Revenue YoY: ${finHtml}
                </div>
                <div>⚠️ Defect Count: <b>${q.defect_count}</b> | Quality Decline: <b>${q.quality_decline_count}</b></div>
                ${swingNote}
                ${missNote}
              </div>
            </div>
          `;
        },
      },
      grid: {
        left: 48,
        right: 48,
        top: 65,
        bottom: 35,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: gridColor } },
        axisLabel: { color: subtextColor, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Tone Score',
          min: -2.2,
          max: 2.2,
          axisLine: { lineStyle: { color: gridColor } },
          axisLabel: { color: subtextColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
        },
        {
          type: 'value',
          name: 'SEC Revenue YoY (%)',
          axisLine: { lineStyle: { color: gridColor } },
          axisLabel: {
            color: subtextColor,
            fontSize: 10,
            formatter: '{value}%',
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Quarterly Avg Tone',
          type: 'line',
          yAxisIndex: 0,
          data: avgTones,
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          itemStyle: { color: '#0a5fc2' },
          lineStyle: { width: 3, color: '#0a5fc2' },
          z: 3,
        },
        {
          name: '4Q Rolling Baseline',
          type: 'line',
          yAxisIndex: 0,
          data: baselineTones,
          smooth: false,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dotted', color: isDark ? '#a78bfa' : '#7c3aed' },
          z: 2,
        },
        {
          name: 'Delta Tone (Deviation)',
          type: 'bar',
          yAxisIndex: 0,
          data: deltaBarData,
          barMaxWidth: 24,
          z: 1,
          markPoint: {
            data: markPointsData,
          },
        },
        {
          name: 'Reddit Canary Tone',
          type: 'line',
          yAxisIndex: 0,
          data: redditTones,
          smooth: true,
          symbol: 'diamond',
          symbolSize: 6,
          lineStyle: { width: 2, type: 'dashed', color: '#f97316' },
          itemStyle: { color: '#f97316' },
          z: 4,
        },
        {
          name: 'SEC Revenue YoY (%)',
          type: 'line',
          yAxisIndex: 1,
          data: revenueYoYs,
          symbol: 'rect',
          symbolSize: 8,
          lineStyle: { width: 2.5, color: '#d97706' },
          itemStyle: { color: '#d97706' },
          z: 5,
        },
      ],
    };

    chart.setOption(option);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
    };
  }, [quarters, productTitle, themeVersion]);

  return (
    <div className="panel chartwrap" style={{ height: 380, padding: '10px 14px' }}>
      <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
