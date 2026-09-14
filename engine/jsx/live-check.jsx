// Minimal end-to-end check that Photoshop is genuinely usable through the
// bridge: create a document, set text with a SolidColor, add an adjustment
// layer, confirm a real layer inventory, export a PNG, and close.
//
// Deliberately small and deliberately written the way the verified recipes in
// the photoshop-delivery skill describe them, so a failure here means the
// environment is wrong rather than the script. Every step appends to the log
// immediately, so a hang still shows which step completed last.
var LOGPATH = 'D:/DSH_GDT/DSH_GraphicDesign_Tools/engine/.probe/live.log';

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

function cID(id) { return charIDToTypeID(id); }
function sID(id) { return stringIDToTypeID(id); }

say('');
say('=== live check ' + new Date().toString() + ' ===');
say('app.version = ' + app.version + '  (COM automation is live)');

app.preferences.rulerUnits = Units.PIXELS;
step('create 900x600 document', function () {
    app.documents.add(900, 600, 72, 'live', NewDocumentMode.RGB, DocumentFill.WHITE);
    return app.activeDocument.name;
});

step('text layer with SolidColor and a real font', function () {
    var l = app.activeDocument.artLayers.add();
    l.kind = LayerKind.TEXT;
    var ti = l.textItem;
    ti.contents = 'MuelSyse 美术';
    ti.size = 72;
    ti.font = 'MiSans-Regular';
    var c = new SolidColor();
    c.rgb.hexValue = '6B7F2E';
    ti.color = c;
    ti.position = [60, 200];
    var b = l.bounds;
    return 'ink box ' + Math.round(b[2].value - b[0].value) + ' x ' + Math.round(b[3].value - b[1].value);
});

step('hue/saturation adjustment layer via contentLayer', function () {
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

step('curves adjustment layer', function () {
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

step('layer inventory', function () {
    var doc = app.activeDocument;
    var names = [];
    for (var i = 0; i < doc.layers.length; i++) names.push(doc.layers[i].name);
    return doc.layers.length + ' layers: ' + names.join(' | ');
});

step('export PNG', function () {
    var doc = app.activeDocument;
    var o = new ExportOptionsSaveForWeb();
    o.format = SaveDocumentType.PNG;
    o.PNG8 = false;
    doc.exportDocument(new File('D:/DSH_GDT/DSH_GraphicDesign_Tools/engine/.probe/live.png'), ExportType.SAVEFORWEB, o);
    return 'written';
});

step('save layered PSD', function () {
    var doc = app.activeDocument;
    var o = new PhotoshopSaveOptions();
    o.layers = true;
    o.embedColorProfile = true;
    doc.saveAs(new File('D:/DSH_GDT/DSH_GraphicDesign_Tools/engine/.probe/live.psd'), o, true, Extension.LOWERCASE);
    return 'written';
});

step('close without saving', function () {
    app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
    return 'closed';
});

say('=== live check end ===');
'PHOTOSHOP LIVE CHECK COMPLETE';
