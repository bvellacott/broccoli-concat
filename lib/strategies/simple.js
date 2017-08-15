'use strict';
var fs = require('fs-extra');
var findIndex = require('find-index');
var merge = require('lodash.merge');
var path = require('path');
var SourceMapConcat = require('fast-sourcemap-concat');

function contentMapper(entry) {
  return entry.content;
}

function SimpleConcat(attrs) {
  this.separator = attrs.separator || '';

  this.header = attrs.header;
  this.headerFiles = attrs.headerFiles || [];
  this.footerFiles = attrs.footerFiles || [];
  this.footer = attrs.footer;
  this.sourceMapConfig = attrs.sourceMapConfig || {};
  this.outputPath = attrs.outputPath;
  this.transform = typeof attrs.transform === 'function' ? 
    attrs.transform :
    function(content) { return content }; 

  console.log(this)

  // Internally, we represent the concatenation as a series of entries. These
  // entries have a 'file' attribute for lookup/sorting and a 'content' property
  // which represents the value to be used in the concatenation.
  this._internal = [];

  // We represent the header/footer files as empty at first so that we don't
  // have to figure out order when patching
  this._internalHeaderFiles = this.headerFiles.map(function(file) { return { file: file }; });
  this._internalFooterFiles = this.footerFiles.map(function(file) { return { file: file }; });
}

SimpleConcat.isPatchBased = true;

SimpleConcat.prototype = merge(SimpleConcat.prototype, {
  /**
   * Finds the index of the given file in the internal data structure.
   */
  _findIndexOf: function(file) {
    return findIndex(this._internal, function(entry) { return entry.file === file; });
  },

  /**
   * Updates the contents of a header file.
   */
  _updateHeaderFile: function(fileIndex, content) {
    this._internalHeaderFiles[fileIndex].content = content;
  },

  /**
   * Updates the contents of a footer file.
   */
  _updateFooterFile: function(fileIndex, content) {
    this._internalFooterFiles[fileIndex].content = content;
  },

  /**
   * Determines if the given file is a header or footer file, and if so updates
   * it with the given contents.
   */
  _handleHeaderOrFooterFile: function(file, content) {
    var headerFileIndex = this.headerFiles.indexOf(file);
    if (headerFileIndex !== -1) {
      this._updateHeaderFile(headerFileIndex, content);
      return true;
    }

    var footerFileIndex = this.footerFiles.indexOf(file);
    if (footerFileIndex !== -1) {
      this._updateFooterFile(footerFileIndex, content);
      return true;
    }

    return false;
  },

  addFile: function(file, content) {
    if (this._handleHeaderOrFooterFile(file, content)) {
      return;
    }

    var entry = {
      file: file,
      content: content,
    };

    var index = findIndex(this._internal, function(entry) { return entry.file > file; });
    if (index === -1) {
      this._internal.push(entry);
    } else {
      this._internal.splice(index, 0, entry);
    }
  },

  removeFile: function(file) {
    var outputPath = this.outputPath;
    this._internal.splice(this._findIndexOf(file), 1);
    fs.removeSync(path.join(outputPath, file));
  },

  setAllUnchanged: function() {
    this._internal = [];
  },

  fileSizes: function() {
    return [].concat(
      this._internalHeaderFiles,
      this._internal,
      this._internalFooterFiles
    ).reduce(function(sizes, entry) {
      sizes[entry.file] = entry.content.length;
      return sizes;
    }, {});
  },

  write: function() {
    var separator = this.separator
    var that = this

    this._internal.forEach(function(entry) {
      entry.context = {}
      entry.content = that.transform.call(entry.context, entry.file, entry.content || '')

      entry.header = []
        .concat(
          typeof that.header === 'function' ? 
            that.header.call(entry.context, entry.file, entry.content) : 
            (that.header || ''), 
          that._internalHeaderFiles.map(contentMapper)
        )
        .filter(function(content) { return !!content })
        .join(separator)

      entry.footer = []
        .concat(
          that._internalFooterFiles.map(contentMapper),
          typeof that.footer === 'function' ? 
            that.footer.call(entry.context, entry.file, entry.content) : 
            (that.footer || '') + (that.footer ? '\n' : '')
        )
        .filter(function(content) { return !!content })
        .join(separator)
    })

    var outputPath = this.outputPath;
    var sourceMapConfig = this.sourceMapConfig

    if(sourceMapConfig.enabled){
      this._internal.forEach(function(entry) {
        var smcc = new SourceMapConcat(merge(
          {}, 
          sourceMapConfig, 
          { outputFile: path.join(outputPath, entry.file) }
        ));
        smcc.addSpace(entry.header);
        smcc.addFileSource(entry.file, entry.content || '')
        smcc.addSpace(entry.footer);
        smcc.end();
      })
      return;
    }

    var fileContents = this._internal
      .filter(function(entry) { return !!entry.content })
      .map(function(entry) {
        entry.content = [
          entry.header, 
          entry.content, 
          entry.footer
        ].join(separator)
        return entry
      })

    console.log('fileContents.length: ', fileContents.length)

    fileContents.forEach(function(fileEntry) {
      fs.outputFileSync(path.join(outputPath, fileEntry.file), fileEntry.content);
    })

  },
});

module.exports = SimpleConcat;
