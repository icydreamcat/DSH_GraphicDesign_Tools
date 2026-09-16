// Can ExtendScript in Photoshop 2026 touch adjustment layers AT ALL?
//
// The creation probe failed for six formulations, including a control on a
// different adjustment family, which rules out a bad ActionDescriptor shape.
// Before recording "impossible", one hypothesis remains: that the failure is
// specific to CREATING an adjustment layer in an ExtendScript-owned document,
// and that an adjustment layer on a document a HUMAN made could still be listed
// and edited.
//
// That distinction decides the recommended workflow, so it is worth one run.
// --- script-relative paths (ExtendScript has no import.meta; $.fileName is the anchor) ---
var __here = (function () {
  var p = $.fileName.replace(/\\/g, "/");
  return p.substring(0, p.lastIndexOf("/"));
})();
function jsxPath(rel) { return __here + "/" + rel; }
// --- end anchor ---
var LOGPATH = jsxPath('.probe/adj2.log');

function say(msg) {
    try {
        var f = new File(LOGPATH);
        f.parent.create();
        f.open('a');
        f.writeln(msg);
        f.close();
    } catch (e) {}
}

say('');
say('=== adjustment access probe ' + new Date().toString() + ' ===');

// 1. Enumerate every LayerKind constant this version exposes. If the adjustment
//    kinds are simply absent from the enum, that is a hard API-level signal.
try {
    var kinds = [];
    for (var k in LayerKind) kinds.push(k + '=' + LayerKind[k]);
    say('LayerKind constants (' + kinds.length + '): ' + kinds.join(', '));
} catch (e) { say('LayerKind enumeration failed: ' + e.message); }

// 2. Open the layered PSD the bridge wrote and inspect its layers.
try {
    var f = new File(jsxPath('.probe/live.psd'));
    if (f.exists) {
        var doc = app.open(f);
        say('opened live.psd: ' + doc.name + '  layers=' + doc.layers.length);
        for (var i = 0; i < doc.layers.length; i++) {
            var L = doc.layers[i];
            say('  layer[' + i + '] name=' + L.name + ' kind=' + L.kind + ' opacity=' + L.opacity + ' blend=' + L.blendMode);
            try { say('        isAdjustmentLayer=' + L.isAdjustmentLayer); } catch (e) { say('        isAdjustmentLayer: n/a'); }
        }
        doc.close(SaveOptions.DONOTSAVECHANGES);
    } else {
        say('live.psd not found at ' + f.fsName);
    }
} catch (e) { say('opening live.psd failed: ' + e.message); }

// 3. Create a fresh doc and try the Mk with a NON-colorLayer target — one more
//    documented variant, then stop.
try {
    var d = app.documents.add(200, 200, 72, 'adj2', NewDocumentMode.RGB, DocumentFill.WHITE);
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(stringIDToTypeID('adjustmentLayer'));
    desc.putReference(charIDToTypeID('null'), ref);
    desc.putEnumerated(charIDToTypeID('Type'), charIDToTypeID('Type'), stringIDToTypeID('hueSaturation'));
    desc.putBoolean(stringIDToTypeID('group'), false);
    executeAction(charIDToTypeID('Mk  '), desc, DialogModes.NO);
    say('OK    Mk adjustmentLayer with Type at top level');
    d.close(SaveOptions.DONOTSAVECHANGES);
} catch (e) {
    say('FAIL  Mk adjustmentLayer with Type at top level -> ' + String(e.message).replace(/[\r\n]+/g, ' '));
}

// 4. And the documented alternative: make the layer via the menu command.
try {
    var d2 = app.documents.add(200, 200, 72, 'adj3', NewDocumentMode.RGB, DocumentFill.WHITE);
    var idMk = charIDToTypeID('Mk  ');
    var d3 = new ActionDescriptor();
    var r3 = new ActionReference();
    r3.putClass(stringIDToTypeID('adjustmentLayer'));
    d3.putReference(charIDToTypeID('null'), r3);
    d3.putEnumerated(charIDToTypeID('Type'), charIDToTypeID('Type'), stringIDToTypeID('brightnessContrast'));
    executeAction(idMk, d3, DialogModes.NO);
    say('OK    Mk adjustmentLayer brightnessContrast (no Usng)');
    d2.close(SaveOptions.DONOTSAVECHANGES);
} catch (e) {
    say('FAIL  Mk adjustmentLayer brightnessContrast (no Usng) -> ' + String(e.message).replace(/[\r\n]+/g, ' '));
}

say('=== probe end ===');
'ADJ2 COMPLETE';
