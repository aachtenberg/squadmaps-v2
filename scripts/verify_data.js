const fs = require('fs');

const jsonPath = 'data/v10_data.json';
const jsPath = 'data/v10_data.js';

const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const jsonLayer = jsonData.W.find(l => l.rawName === 'Harju_RAAS_v1');
console.log('JSON Harju_RAAS_v1 Charlie pointsOrder:', jsonLayer.capturePoints.lanes.laneObjects.Charlie.pointsOrder);

const jsContent = fs.readFileSync(jsPath, 'utf8');
const prefix = 'window.SQUAD_DATA = ';
const suffix = ';';
const jsonString = jsContent.substring(jsContent.indexOf('{'), jsContent.lastIndexOf(suffix));
const jsData = JSON.parse(jsonString);
const jsLayer = jsData.W.find(l => l.rawName === 'Harju_RAAS_v1');
console.log('JS Harju_RAAS_v1 Charlie pointsOrder:', jsLayer.capturePoints.lanes.laneObjects.Charlie.pointsOrder);
