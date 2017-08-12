var Plugin = require('broccoli-plugin');
var FSTree = require('fs-tree-diff');
var path = require('path');
var fs = require('fs-extra');
var merge = require('lodash.merge');
var omit = require('lodash.omit');
var uniq = require('lodash.uniq');
var walkSync = require('walk-sync');
var ensurePosix = require('ensure-posix-path');

var ensureNoGlob = require('./lib/utils/ensure-no-glob');
var isDirectory = require('./lib/utils/is-directory');
var makeIndex = require('./lib/utils/make-index');

module.exports = Concat;
Concat.prototype = Object.create(Plugin.prototype);
Concat.prototype.constructor = Concat;

var id = 0;
function Concat(inputNode, options, Strategy) {
  if (!(this instanceof Concat)) {
    return new Concat(inputNode, options, Strategy);
  }

  var inputNodes;
  id++;

  inputNodes = [inputNode];

  Plugin.call(this, inputNodes, {
    annotation: options.annotation,
    name: (Strategy.name || 'Unknown') + 'Concat',
    persistentOutput: true
  });

  this.id = id;

  if (Strategy === undefined) {
    throw new TypeError('Concat requires a concat Strategy');
  }

  this.Strategy = Strategy;
  this.outputDir = options.outputDir;
  this.sourceMapConfig = options.sourceMapConfig || {};
  this.allInputFiles = uniq([].concat(options.headerFiles || [], options.inputFiles || [], options.footerFiles || []));
  this.inputFiles = options.inputFiles;
  this.outputFile = options.outputFile;
  this.allowNone = options.allowNone;
  this.header = options.header;
  this.headerFiles = options.headerFiles;
  this._headerFooterFilesIndex = makeIndex(options.headerFiles, options.footerFiles);
  this.footer = options.footer;
  this.footerFiles = options.footerFiles;
  this.separator = (options.separator != null) ? options.separator : '\n';
  this.transform = options.transform;

  ensureNoGlob('headerFiles', this.headerFiles);
  ensureNoGlob('footerFiles', this.footerFiles);

  this._lastTree = FSTree.fromEntries([]);
  this._hasBuilt = false;

  this.encoderCache = {};
}

Concat.prototype.calculatePatch = function() {
  var currentTree = this.getCurrentFSTree();
  var patch = this._lastTree.calculatePatch(currentTree);

  this._lastTree = currentTree;

  return patch;
};

Concat.prototype.build = function() {
  var patch = this.calculatePatch();

  // We skip building if this is a rebuild with a zero-length patch
  if (patch.length === 0 && this._hasBuilt) {
    return;
  }

  this._hasBuilt = true;

  return this._doPatchBasedBuild(patch);
};

Concat.prototype._doPatchBasedBuild = function(patch) {
  if (!this.concat) {
    this.concat = new this.Strategy({
      outputPath: this.outputPath,
      separator: this.separator,
      header: this.header,
      headerFiles: this.headerFiles,
      footerFiles: this.footerFiles,
      footer: this.footer,
      sourceMapConfig: this.sourceMapConfig,
      transform: this.transform,
    });
  }

  this.concat.setAllUnchanged()

  for (var i = 0; i < patch.length; i++) {
    var operation = patch[i];
    var method = operation[0];
    var file = operation[1]

    switch (method) {
      case 'create':
      case 'change':
        this.concat.addFile(file, this._readFile(file));
        break;
      case 'unlink':
        this.concat.removeFile(file)
        break;
    }
  }

  this.concat.write();
};

Concat.prototype._readFile = function(file) {
  return fs.readFileSync(path.join(this.inputPaths[0], file), 'UTF-8');
};

Concat.prototype.getCurrentFSTree = function() {
  return FSTree.fromEntries(this.listEntries());
};

Concat.prototype.listEntries = function() {
  // If we have no inputFiles at all, use undefined as the filter to return
  // all files in the inputDir.
  var filter = this.allInputFiles.length ? this.allInputFiles : undefined;
  var inputDir = this.inputPaths[0];
  return walkSync.entries(inputDir, filter);
};

