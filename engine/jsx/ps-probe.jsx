/* eslint-disable */
// Minimal, defensively-written Photoshop probe.
//
// Difference from the previous attempt: every step appends to the log file
// IMMEDIATELY (open/append/close per line) rather than buffering in an array
// and writing at the end. If Photoshop hangs or crashes on step 12, the log
// still contains steps 1..11 — which is the whole point, because the previous
// probe died silently and left no evidence about where.
//
// Each step is also chosen to be something that CANNOT raise a modal dialog:
// no filter that may prompt, no file open, no save-as overwrite prompt.

// --- script-relative paths (ExtendScript has no import.meta; $.fileName is the anchor) ---
var __here = (function () {
  var p = $.fileName.replace(/\\/g, "/");
  return p.substring(0, p.lastIndexOf("/"));
})();
function jsxPath(rel) { return __here + "/" + rel; }
// --- end anchor ---
var LOGPATH = jsxPath('.probe/ps-probe.log');

function say(msg) {
    try {
        var f = new File(LOGPATH);
        f.parent.create();
        f.open('a');
        f.writeln(msg);
        f.close();
    } catch (e) { /* nothing we can do */ }
}

function step(label, fn) {
    try {
        var r = fn();
        say('OK    ' + label + (r === undefined || r === null ? '' : '  -> ' + r));
    } catch (e) {
        say('FAIL  ' + label + '  -> ' + (e && e.message ? e.message : String(e)));
    }
}

function sID(id) { return stringIDToTypeID(id); }
function cID(id) { return charIDToTypeID(id); }

say('');
say('=== probe start ' + new Date().toString() + ' ===');
say('app.version = ' + app.version);

app.preferences.rulerUnits = Units.PIXELS;
say('rulerUnits set');

// ── 1. document + text colour, the headline correction ─────────────────────
step('1a create doc', function () {
    app.documents.add(900, 600, 72, 'p1', NewDocumentMode.RGB, DocumentFill.WHITE);
    return app.activeDocument.name;
});

step('1b text layer, SolidColor hex, MiSans', function () {
    var l = app.activeDocument.artLayers.add();
    l.kind = LayerKind.TEXT;
    var ti = l.textItem;
    ti.contents = 'MuelSyse';
    ti.size = 90;
    ti.font = 'MiSans-Regular';
    var c = new SolidColor();
    c.rgb.hexValue = '5F7A2A';
    ti.color = c;
    ti.position = [60, 200];
    ti.tracking = -10;
    return 'ok, measured width needed';
});

step('1c report text metrics via bounds', function () {
    var l = app.activeDocument.activeLayer;
    var b = l.bounds;
    return 'bounds L=' + b[0].value + ' T=' + b[1].value + ' R=' + b[2].value + ' B=' + b[3].value;
});

// ── 2. adjustment layers, the correction that matters most ─────────────────
step('2a adjustment layer via contentLayer', function () {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(sID('adjustmentLayer'));
    d.putReference(cID('null'), r);
    var adj = new ActionDescriptor();
    adj.putEnumerated(cID('Type'), cID('Type'), sID('hueSaturation'));
    d.putObject(cID('Usng'), sID('contentLayer'), adj);
    executeAction(cID('Mk  '), d, DialogModes.NO);
    return app.activeDocument.activeLayer.name;
});

step('2b curves adjustment layer', function () {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(sID('adjustmentLayer'));
    d.putReference(cID('null'), r);
    var adj = new ActionDescriptor();
    adj.putEnumerated(cID('Type'), cID('Type'), sID('curves'));
    d.putObject(cID('Usng'), sID('contentLayer'), adj);
    executeAction(cID('Mk  '), d, DialogModes.NO);
    return app.activeDocument.activeLayer.name;
});

step('2c gradient fill layer (real gradient, not stacked rects)', function () {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(sID('contentLayer'));
    d.putReference(cID('null'), r);
    var gl = new ActionDescriptor();
    gl.putEnumerated(cID('Type'), cID('Type'), sID('linear'));
    gl.putUnitDouble(sID('angle'), sID('angleUnit'), 90);
    gl.putEnumerated(sID('gradientForm'), sID('gradientForm'), sID('linear'));
    gl.putDouble(sID('scale'), 100);
    var stops = new ActionList();
    var s0 = new ActionDescriptor();
    s0.putUnitDouble(sID('location'), sID('percentUnit'), 0);
    s0.putDouble(sID('midpoint'), 50);
    var c0 = new ActionDescriptor();
    c0.putDouble(cID('Rd  '), 255); c0.putDouble(cID('Grn '), 255); c0.putDouble(cID('Bl  '), 255);
    s0.putObject(cID('Clr '), cID('RGBC'), c0);
    stops.putObject(sID('colorStop'), s0);
    var s1 = new ActionDescriptor();
    s1.putUnitDouble(sID('location'), sID('percentUnit'), 100);
    s1.putDouble(sID('midpoint'), 50);
    var c1 = new ActionDescriptor();
    c1.putDouble(cID('Rd  '), 122); c1.putDouble(cID('Grn '), 143); c1.putDouble(cID('Bl  '), 46);
    s1.putObject(cID('Clr '), cID('RGBC'), c1);
    stops.putObject(sID('colorStop'), s1);
    gl.putList(sID('colors'), stops);
    d.putObject(cID('Usng'), sID('contentLayer'), gl);
    executeAction(cID('Mk  '), d, DialogModes.NO);
    return app.activeDocument.activeLayer.name;
});

// ── 3. layer mask from a real selection ────────────────────────────────────
step('3a layer mask via Mk/Chnl/Usng/UserMaskEnabled', function () {
    var doc = app.activeDocument;
    var l = doc.artLayers.add();
    doc.activeLayer = l;
    app.foregroundColor.rgb.hexValue = '333333';
    doc.selection.select([[80, 380], [500, 380], [500, 540], [80, 540]]);
    doc.selection.fill(app.foregroundColor);
    var d = new ActionDescriptor();
    d.putClass(cID('Nw  '), cID('Chnl'));
    var r = new ActionReference();
    r.putClass(cID('Chnl'));
    d.putReference(cID('At  '), r);
    d.putEnumerated(cID('Usng'), cID('UserMaskEnabled'), cID('RvlS'));
    executeAction(cID('Mk  '), d, DialogModes.NO);
    doc.selection.deselect();
    return 'mask created';
});

// ── 4. clipping mask ───────────────────────────────────────────────────────
step('4a clipping mask via groupEvent + setd', function () {
    var doc = app.activeDocument;
    var base = doc.artLayers.add();
    doc.activeLayer = base;
    app.foregroundColor.rgb.hexValue = '2E3A16';
    doc.selection.select([[550, 380], [860, 380], [860, 560], [550, 560]]);
    doc.selection.fill(app.foregroundColor);
    doc.selection.deselect();
    var clip = doc.artLayers.add();
    doc.activeLayer = clip;
    app.foregroundColor.rgb.hexValue = 'E4EC8A';
    doc.selection.select([[560, 350], [900, 350], [900, 600], [560, 600]]);
    doc.selection.fill(app.foregroundColor);
    doc.selection.deselect();

    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putEnumerated(cID('Lyr '), cID('Ordn'), cID('Trgt'));
    d.putReference(cID('null'), r);
    executeAction(sID('groupEvent'), d, DialogModes.NO);

    var d2 = new ActionDescriptor();
    var r2 = new ActionReference();
    r2.putEnumerated(cID('Lyr '), cID('Ordn'), cID('Trgt'));
    d2.putReference(cID('null'), r2);
    d2.putBoolean(sID('group'), true);
    executeAction(sID('setd'), d2, DialogModes.NO);
    return 'clipping applied';
});

// ── 5. halftonePattern, grayscale only ─────────────────────────────────────
step('5a halftonePattern on grayscale doc', function () {
    var g = app.documents.add(400, 300, 72, 'gray', NewDocumentMode.GRAYSCALE, DocumentFill.WHITE);
    var l = g.artLayers.add();
    g.activeLayer = l;
    g.selection.select([[0, 0], [400, 0], [400, 300], [0, 300]]);
    app.foregroundColor.rgb.hexValue = '999999';
    g.selection.fill(app.foregroundColor);
    g.selection.deselect();
    var d = new ActionDescriptor();
    d.putEnumerated(sID('patternType'), sID('patternType'), sID('halftoneScreen'));
    d.putUnitDouble(sID('size'), sID('pixelsUnit'), 6);
    d.putInteger(sID('contrast'), 8);
    executeAction(sID('halftonePattern'), d, DialogModes.NO);
    g.close(SaveOptions.DONOTSAVECHANGES);
    return 'grayscale halftone OK';
});

// ── 6. gradients on a raster via the gradient tool API ─────────────────────
step('6a rasterize a text layer', function () {
    var doc = app.activeDocument;
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].kind === LayerKind.TEXT) {
            doc.activeLayer = doc.layers[i];
            break;
        }
    }
    executeAction(sID('rasterizeLayer'), new ActionDescriptor(), DialogModes.NO);
    return 'rasterized ' + doc.activeLayer.name;
});

step('6b save layered PSD', function () {
    var doc = app.activeDocument;
    var o = new PhotoshopSaveOptions();
    o.layers = true;
    o.embedColorProfile = true;
    doc.saveAs(new File(jsxPath('.probe/probe.psd')), o, true, Extension.LOWERCASE);
    return 'psd saved';
});

step('6c export PNG', function () {
    var doc = app.activeDocument;
    var o = new ExportOptionsSaveForWeb();
    o.format = SaveDocumentType.PNG;
    o.PNG8 = false;
    doc.exportDocument(new File(jsxPath('.probe/probe.png')), ExportType.SAVEFORWEB, o);
    return 'png saved';
});

step('7 list layers', function () {
    var doc = app.activeDocument;
    var names = [];
    for (var i = 0; i < doc.layers.length; i++) {
        names.push(doc.layers[i].name);
    }
    return doc.layers.length + ': ' + names.join(' | ');
});

say('=== probe end ===');
'PROBE COMPLETE';
