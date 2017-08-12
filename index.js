var Concat = require('./concat');
var merge = require('lodash.merge');

module.exports = function(inputNode, options) {

  var config = merge({
    enabled: true
  }, options.sourceMapConfig);

  return new Concat(inputNode, options, require('./lib/strategies/simple'));
};
