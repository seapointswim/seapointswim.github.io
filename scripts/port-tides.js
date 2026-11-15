'use strict';
const {localToUtc} = require('../site/core');
const PORT_TABLE = 'https://www.dublinport.ie/information-centre/tide-tables/';

function portTableEvents(html) {
  const table = html.match(/<table\b[^>]*\bid=["']table_example["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!table) throw Error('Dublin Port tide table is missing');
  const rows = [];
  for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(row[1].matchAll(/<td\b[^>]*>\s*([^<>]*?)\s*<\/td>/gi), m => m[1]);
    if (!cells.length) continue;
    const [date, time, height] = cells;
    if (cells.length !== 3 || !/^\d{2}:\d{2}(:00)?$/.test(time) || !/^-?\d+(\.\d+)?$/.test(height)) {
      throw Error('Unrecognised Dublin Port tide table row');
    }
    const t = localToUtc(date, time.slice(0, 5));
    if (!Number.isFinite(t)) throw Error('Invalid tide table timestamp');
    rows.push({t, h:Number(height)});
  }
  rows.sort((a, b) => a.t - b.t);
  if (rows.length < 4) throw Error('Incomplete Dublin Port tide table');
  // Published rows are successive turning points, sometimes delivered out of order.
  // Check continuity before inferring high/low from the neighbouring heights.
  return rows.map((row, i) => {
    const previous = rows[i-1], next = rows[i+1];
    const high = previous ? row.h > previous.h : row.h > next.h;
    if ((previous && (row.t - previous.t < 3*3600000 || row.t - previous.t > 9*3600000 || row.h === previous.h)) ||
        (next && (high ? row.h <= next.h : row.h >= next.h))) {
      throw Error('Dublin Port table has missing or inconsistent turning points');
    }
    return {...row, type:high ? 'high' : 'low'};
  });
}

function withPortTable(model, published) {
  if (!published.length) return model;
  const margin = 2*3600000;
  const first = published[0].t, last = published.at(-1).t;
  const table = published.map(event => {
    const result = {...event, source:'port-table'};
    if (event.type === 'low') {
      const low = model.find(e => e.type === 'low' && Math.abs(e.t - event.t) <= margin);
      if (low) result.modelLowHeight = low.h;
    }
    return result;
  });
  return [...model.filter(e => e.t < first-margin), ...table, ...model.filter(e => e.t > last+margin)];
}
module.exports = {PORT_TABLE, portTableEvents, withPortTable};
