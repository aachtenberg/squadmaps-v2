const fs = require('fs');
const path = require('path');

const jsonPath = 'data/v10_data.json';
const jsPath = 'data/v10_data.js';

function updatePointsOrder(pointsOrder) {
    const desiredStart = ['00-Team1 Main', 'C1-CaptureZoneCluster', 'C3-CaptureZoneCluster', 'C2-CaptureZoneCluster'];
    const end = 'Z-Team2 Main';
    
    const rest = pointsOrder.filter(p => !desiredStart.includes(p) && p !== end);
    const newOrder = [...desiredStart, ...rest, end];
    return [...new Set(newOrder)];
}

// Update JSON
const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const list = jsonData.W;
const layer = list.find(l => l.rawName === 'Harju_RAAS_v1');
if (layer && layer.capturePoints && layer.capturePoints.lanes && layer.capturePoints.lanes.laneObjects && layer.capturePoints.lanes.laneObjects.Charlie) {
    layer.capturePoints.lanes.laneObjects.Charlie.pointsOrder = updatePointsOrder(layer.capturePoints.lanes.laneObjects.Charlie.pointsOrder);
}
fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));

// Update JS
let jsContent = fs.readFileSync(jsPath, 'utf8');
const prefix = 'window.SQUAD_DATA = ';
const suffix = ';';
const jsonString = jsContent.substring(prefix.indexOf('{'), jsContent.lastIndexOf(suffix));
const jsData = JSON.parse(jsonString);

const jsList = jsData.W;
const jsLayer = jsList.find(l => l.rawName === 'Harju_RAAS_v1');
if (jsLayer && jsLayer.capturePoints && jsLayer.capturePoints.lanes && jsLayer.capturePoints.lanes.laneObjects && jsLayer.capturePoints.lanes.laneObjects.Charlie) {
    jsLayer.capturePoints.lanes.laneObjects.Charlie.pointsOrder = updatePointsOrder(jsLayer.capturePoints.lanes.laneObjects.Charlie.pointsOrder);
}
fs.writeFileSync(jsPath, prefix + JSON.stringify(jsData, null, 2) + suffix);

console.log('Update complete.');
