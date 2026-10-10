import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { QuarterlyAggregation } from '../../../shared/review-types';

interface EditorialChartProps {
  quarters: QuarterlyAggregation[];
}

export function EditorialChart({ quarters }: EditorialChartProps) {
  const lineChartRef = useRef<HTMLDivElement>(null);
  const barChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lineChartRef.current || !barChartRef.current || quarters.length === 0) return;

    const lineChart = echarts.init(lineChartRef.current);
    const barChart = echarts.init(barChartRef.current);

    // Labels formatted as "Q3\nFY25", "Q4\nFY25", etc.
    const xLabels = quarters.map((q) => {
      const parts = (q.quarter_label || q.calendar_quarter).split(' ');
      if (parts.length === 2) {
        return `${parts[1]}\n${parts[0]}`;
      }
      return q.quarter_label;
    });

    const meanTones = quarters.map((q) => (q.avg_tone != null ? Number(q.avg_tone.toFixed(2)) : null));
    const baselines = quarters.map((q) => (q.baseline_tone != null ? Number(q.baseline_tone.toFixed(2)) : null));
    const reviewCounts = quarters.map((q) => q.product_review_count ?? q.review_count);

    // 1. Line Chart Option (Product-review tone vs baseline)
    const lineOption: echarts.EChartsOption = {
      backgroundColor: '#121418',
      animation: false,
      grid: {
        top: 48,
        left: 36,
        right: 28,
        bottom: 38,
        containLabel: true,
      },
      legend: {
        top: 12,
        left: 20,
        icon: 'rect',
        itemWidth: 16,
        itemHeight: 2,
        textStyle: { color: '#9ca3af', fontSize: 12 },
        data: [
          { name: 'Mean tone', icon: 'line', itemStyle: { color: '#3b82f6', borderWidth: 2 } },
          { name: 'Prior-four-quarter baseline', icon: 'line', itemStyle: { color: '#9ca3af', borderDashOffset: 4 } },
        ],
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1f242d',
        borderColor: '#374151',
        textStyle: { color: '#f3f4f6', fontSize: 12 },
        valueFormatter: (val: any) => (val != null ? Number(val).toFixed(3) : 'N/A'),
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLine: { lineStyle: { color: '#2d333b' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#8b949e',
          fontSize: 11,
          lineHeight: 14,
          interval: 0,
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1.5,
        interval: 0.25,
        splitLine: { lineStyle: { color: '#1c2128', type: 'solid' } },
        axisLabel: { color: '#6e7681', fontSize: 11 },
      },
      series: [
        {
          name: 'Mean tone',
          type: 'line',
          data: meanTones,
          smooth: false,
          symbol: 'circle',
          symbolSize: 8,
          itemStyle: {
            color: '#3b82f6',
            borderColor: '#ffffff',
            borderWidth: 1.5,
          },
          lineStyle: {
            color: '#3b82f6',
            width: 2.5,
          },
          label: {
            show: true,
            position: 'top',
            distance: 6,
            formatter: (params: any) => (params.value != null ? Number(params.value).toFixed(2) : ''),
            color: '#e5e7eb',
            fontSize: 11,
            fontWeight: 600,
          },
        },
        {
          name: 'Prior-four-quarter baseline',
          type: 'line',
          data: baselines,
          smooth: false,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: {
            color: '#d1d5db',
          },
          lineStyle: {
            color: '#9ca3af',
            width: 1.8,
            type: [4, 4],
          },
          label: {
            show: true,
            position: 'top',
            distance: 6,
            formatter: (params: any) => (params.value != null ? Number(params.value).toFixed(2) : ''),
            color: '#9ca3af',
            fontSize: 10,
          },
        },
      ],
    };

    // 2. Bar Chart Option (Product reviews by quarter)
    const barOption: echarts.EChartsOption = {
      backgroundColor: '#121418',
      animation: false,
      grid: {
        top: 24,
        left: 36,
        right: 28,
        bottom: 38,
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1f242d',
        borderColor: '#374151',
        textStyle: { color: '#f3f4f6', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLine: { lineStyle: { color: '#2d333b' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#8b949e',
          fontSize: 11,
          lineHeight: 14,
          interval: 0,
        },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1c2128', type: 'solid' } },
        axisLabel: { color: '#6e7681', fontSize: 11 },
      },
      series: [
        {
          name: 'Reviews',
          type: 'bar',
          data: reviewCounts,
          barWidth: '40%',
          itemStyle: {
            color: '#1d4ed8',
            borderRadius: [2, 2, 0, 0],
          },
          label: {
            show: true,
            position: 'top',
            color: '#93c5fd',
            fontSize: 11,
            fontWeight: 600,
          },
        },
      ],
    };

    lineChart.setOption(lineOption);
    barChart.setOption(barOption);

    const handleResize = () => {
      lineChart.resize();
      barChart.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      lineChart.dispose();
      barChart.dispose();
    };
  }, [quarters]);

  return (
    <div className="rv-stack">
      {/* Top Line Chart Container */}
      <div
        style={{
          background: '#121418',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 8,
          padding: '16px 16px 8px 16px',
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#f3f4f6', margin: 0 }}>
            Product-review tone vs baseline
          </h3>
          <p style={{ fontSize: 12, color: '#8b949e', margin: '4px 0 0 0' }}>
            Baseline is the mean tone of the four prior quarters, so it starts in FY26 Q3.
          </p>
        </div>
        <div ref={lineChartRef} style={{ width: '100%', height: 260 }} />
      </div>

      {/* Bottom Bar Chart Container */}
      <div
        style={{
          background: '#121418',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 8,
          padding: '16px 16px 8px 16px',
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f3f4f6', margin: 0 }}>
            Product reviews by quarter
          </h3>
          <p style={{ fontSize: 11.5, color: '#8b949e', margin: '3px 0 0 0' }}>
            Seller-only records are excluded from tone calculation.
          </p>
        </div>
        <div ref={barChartRef} style={{ width: '100%', height: 180 }} />
      </div>
    </div>
  );
}
