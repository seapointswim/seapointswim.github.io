'use strict';
const fs=require('node:fs');
const filename='site/data/conditions.json';
if(!fs.existsSync(filename))throw Error('The conditions snapshot was not produced');
const data=JSON.parse(fs.readFileSync(filename,'utf8'));
if(data.schemaVersion!==3||!Number.isFinite(Date.parse(data.generatedAt)))throw Error('Invalid snapshot schema/time');
if(data.notes?.tides?.stationID!==require('../site/core').SEAPOINT_STATION)throw Error('Unexpected tide station');
for(const id of ['tide','wind','waves','seaTemp','buoy','warnings','alerts'])if(!data.sources?.[id]?.status)throw Error('Missing source status: '+id);
if((data.tidePoints||[]).length&&!Array.isArray(data.events))throw Error('Missing tide events');
console.log('Valid snapshot. Source statuses: '+Object.entries(data.sources).map(([k,v])=>k+':'+v.status).join(', '));

if(data.wind?.model!=='ecmwf_ifs')throw Error('Expected ECMWF forecast');
