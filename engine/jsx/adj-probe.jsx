// Is the adjustment-layer failure a SCRIPT SYNTAX problem or a genuine
// limitation of Photoshop 2026?
//
// The live check failed with the generic "该功能可能无法在这个版本的 Photoshop
// 中使用 / 不能完成命令，因为程序错误" on both hueSaturation and curves. That is
// precisely the message the project brief mistook for a missing capability — and
// precisely the case where you must try more than one correct formulation before
// concluding anything.
//
// So this tries several documented shapes for each, and reports which one (if
// any) works. Whichever succeeds becomes the recipe.
var LOGPATH = 'D:/DSH_GDT/DSH_GraphicDesign_Tools/engine/.probe/adj.log';

function say(msg) {
    try {
        var f = new File(LOGPATH);
        f.parent.create();
        f.open('a');
        f.writeln(msg);
        f.close();
    } catch (e) {}
}
function step(label, fn) {
    try {
        var r = fn();
        say('OK    ' + label + (r === undefined || r === null ? '' : '  -> ' + r));
        return true;
    } catch (e) {
        say('FAIL  ' + label + '  -> ' + (e && e.message ? e.message : String(e)).replace(/[\r\n]+/g, ' '));
        return false;
    }
}
function cID(id) { return charIDToTypeID(id); }
function sID(id) { return stringIDToTypeID(id); }

say('');
say('=== adjustment-layer probe ' + new Date().toString() + ' ===');
say('app.version = ' + app.version);

app.documents.add(400, 300, 72, 'adj', NewDocumentMode.RGB, DocumentFill.WHITE);

function layerNames() {
    var d = app.activeDocument, out = [];
    for (var i = 0; i < d.layers.length; i++) out.push(d.layers[i].name + '(' + d.layers[i].kind + ')');
    return out.join(' | ');
}
say('layers before: ' + layerNames());

// ── A: Mk + adjustmentLayer + Adjs (the shape that failed) ─────────────────
step('A: Mk adjustmentLayer + Type only', function () {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(sID('adjustmentLayer'));
    d.putReference(cID('null'), r);
    var a = new ActionDescriptor();
    a.putEnumerated(cID('Type'), cID('Type'), sID('hueSaturation'));
    d.putObject(cID('Usng'), sID('adjustmentLayer'), a);
    executeAction(cID('Mk  '), d, DialogModes.NO);
    return app.activeDocument.activeLayer.name;
});

// ── B: Mk + adjustmentLayer + Adjs payload ─────────────────────────────────
step('B: Mk adjustmentLayer + Adjs payload', function () {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(sID('adjustmentLayer'));
    d.putReference(cID('null'), r);
    var a = new ActionDescriptor();
    a.putEnumerated(cID('Type'), cID('Type'), sID('hueSaturation'));
    var payload = new ActionDescriptor();
    payload.putEnumerated(cID('Type'), cID('Type'), sID('hueSaturation'));
    payload.putUnitDouble(sID('hue'), sID('angleUnit'), -20);
    payload.putUnitDouble(sID('saturation'), sID('percentUnit'), -30);
    a.putObject(cID('Adjs'), sID('hueSaturation'), payload);
    d.putObject(cID('Usng'), sID('adjustmentLayer'), a);
    executeAction(cID('Mk  '), d, DialogModes.NO);
    return app.activeDocument.activeLayer.name;
});

// ── C: Mk + contentLayer with full Adjs ────────────────────────────────────
step('C: Mk contentLayer + Adjs payload', function () {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(sID('adjustmentLayer'));
    d.putReference(cID('null'), r);
    var a = new ActionDescriptor();
    a.putEnumerated(cID('Type'), cID('Type'), sID('hueSaturation'));
    var payload = new ActionDescriptor();
    payload.putEnumerated(cID('Type'), cID('Type'), sID('hueSaturation'));
    payload.putUnitDouble(sID('hue'), sID('angleUnit'), -20);
    payload.putUnitDouble(sID('saturation'), sID('percentUnit'), -30);
    a.putObject(cID('Adjs'), sID('hueSaturation'), payload);
    d.putObject(cID('Usng'), sID('contentLayer'), a);
    executeAction(cID('Mk  '), d, DialogModes.NO);
    return app.activeDocument.activeLayer.name;
});

// ── D: curves the same way ─────────────────────────────────────────────────
step('D: curves via contentLayer + Adjs payload', function () {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(sID('adjustmentLayer'));
    d.putReference(cID('null'), r);
    var a = new ActionDescriptor();
    a.putEnumerated(cID('Type'), cID('Type'), sID('curves'));
    var payload = new ActionDescriptor();
    payload.putEnumerated(cID('Type'), cID('Type'), sID('curves'));
    a.putObject(cID('Adjs'), sID('curves'), payload);
    d.putObject(cID('Usng'), sID('contentLayer'), a);
    executeAction(cID('Mk  '), d, DialogModes.NO);
    return app.activeDocument.activeLayer.name;
});

// ── E: plain levels as a control (a different adjustment family) ───────────
step('E: levels via contentLayer (control)', function () {
    var d = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(sID('adjustmentLayer'));
    d.putReference(cID('null'), r);
    var a = new ActionDescriptor();
    a.putEnumerated(cID('Type'), cID('Type'), sID('levels'));
    var payload = new ActionDescriptor();
    payload.putEnumerated(cID('Type'), cID('Type'), sID('levels'));
    a.putObject(cID('Adjs'), sID('levels'), payload);
    d.putObject(cID('Usng'), sID('contentLayer'), a);
    executeAction(cID('Mk  '), d, DialogModes.NO);
    return app.activeDocument.activeLayer.name;
});

// ── F: can an EXISTING (human-made) adjustment layer be edited? ────────────
step('F: is any adjustment kind reachable at all?', function () {
    var kinds = ['brightnessContrast', 'invert', 'threshold', 'posterize', 'blackAndWhite', 'photoFilter', 'channelMixer', 'gradientMap'];
    var worked = [];
    for (var i = 0; i < kinds.length; i++) {
        try {
            var d = new ActionDescriptor();
            var r = new ActionReference();
            r.putClass(sID('adjustmentLayer'));
            d.putReference(cID('null'), r);
            var a = new ActionDescriptor();
            a.putEnumerated(cID('Type'), cID('Type'), sID(kinds[i]));
            var payload = new ActionDescriptor();
            payload.putEnumerated(cID('Type'), cID('Type'), sID(kinds[i]));
            a.putObject(cID('Adjs'), sID(kinds[i]), payload);
            d.putObject(cID('Usng'), sID('contentLayer'), a);
            executeAction(cID('Mk  '), d, DialogModes.NO);
            worked.push(kinds[i]);
        } catch (e) { /* not available */ }
    }
    return worked.length ? ('reachable: ' + worked.join(', ')) : 'NONE reachable';
});

say('layers after:  ' + layerNames());
say('=== probe end ===');
'ADJ PROBE COMPLETE';
