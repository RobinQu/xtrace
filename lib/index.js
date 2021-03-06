var prop = Object.defineProperty;
var Event = require('./event');
var Layer = require('./layer');
var Store = require('./store');
var Context = require('./context');
var trace = require('stack-trace');
var path = require('path');
var fs = require('fs');
var debug = require('debug')('xtrace:main');
var util = require('util');
var _ = require('lodash');

var noop = function () {};

var xtrace = module.exports = function (config) {
  //setup context
  Context.get().configure(config);
  //bootstrap first
  process.nextTick(xtrace.bootstrap);
  //monkey patch
  require('./monkey_patch').defaults().enable();
};

_.extend(xtrace, {
  Layer: Layer,
  Event: Event,
  Context: Context,
  reporters: {
    Console: require('./reporters/console')
  }
});

prop(xtrace, 'tracing', {
  enumerable: false,
  configurable: false,
  get: function () {
    return !!Event.last;
  }
});

xtrace.backtrace = trace.get;

xtrace.instrument = function (build, run, callback) {
  callback = callback || noop;
  if (!Layer.last) {
    debug('no layer to run instrument');
    return run(callback);
  }

  debug('instrument');

  var builder = typeof build === 'function' ? build : function (last) {
    return last.descend(build);
  };

  var layer = builder(Layer.last);

  layer.events.entry.set({backtrace: xtrace.backtrace()});

  debug('run fn async? %s', !!run.length);
  return layer.run(run.length ? function (wrap) {
    return run(wrap(callback));
  } : run);
};

xtrace.bootstrap = function () {
  debug('bootstrap');
  Store.getInstance().run(function () {
    var base = path.join(process.cwd(), 'node_modules');
    var modules = [];
    try {
      modules = fs.readdirSync(base);
    } catch (e) {
      debug(e);
    }

    var data = {
      'bootstrap': true,
      'Node.Version': process.versions.node,
      'Node.V8.Version': process.versions.v8,
      'Node.LibUV.Version': process.versions.uv,
      'Node.OpenSSL.Version': process.versions.openssl,
      'Node.Ares.Version': process.versions.ares,
      'Node.ZLib.Version': process.versions.zlib,
      'Node.HTTPParser.Version': process.versions.http_parser
    };

    if (util.isArray(modules)) {
      modules.forEach(function (mod) {
        if (mod === '.bin' || mod[0] === '@') {//./bin folder and private scoped modules
          return;
        }
        try {
          var pkg = require(base + '/' + mod + '/package.json');
          data['Node.Module.' + pkg.name + '.Version'] = pkg.version;
        } catch (e) {
          debug(e);
        }
      });
    }

    var layer = new Layer('nodejs', null, data);
    layer.enter();
    layer.exit();
    process.nextTick(function () {
      Context.get().emit('bootstrap', data);
    });
  });
};

['trace', 'log', 'info', 'debug', 'error'].forEach(function (name) {
  xtrace[name] = function () {
    var msg = util.format.apply(arguments);
    var layer = Layer.last;
    if(layer) {
      layer.info({
        console: true,
        level: name,
        message: msg
      });
    } else {
      debug('no usable layer to attach message: %s', msg);
    }
  };
});
