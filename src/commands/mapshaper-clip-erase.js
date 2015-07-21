/* @requires
mapshaper-dataset-utils
mapshaper-path-division
mapshaper-polygon-clipping
mapshaper-polyline-clipping
mapshaper-point-clipping
mapshaper-arc-dissolve
*/

api.clipLayers = function(target, src, dataset, opts) {
  return MapShaper.clipLayers(target, src, dataset, "clip", opts);
};

api.eraseLayers = function(target, src, dataset, opts) {
  return MapShaper.clipLayers(target, src, dataset, "erase", opts);
};

api.clipLayer = function(targetLyr, src, dataset, opts) {
  return api.clipLayers([targetLyr], src, dataset, opts)[0];
};

api.eraseLayer = function(targetLyr, src, dataset, opts) {
  return api.eraseLayers([targetLyr], src, dataset, opts)[0];
};

// @target: a single layer or an array of layers
// @type: 'clip' or 'erase'
MapShaper.clipLayers = function(targetLayers, src, srcDataset, type, opts) {
  var clipLyr =  MapShaper.getClipLayer(src, srcDataset, opts),
      usingPathClip = utils.some(targetLayers, MapShaper.layerHasPaths),
      nodes, outputLayers, dataset;
  opts = opts || {};
  MapShaper.requirePolygonLayer(clipLyr, "[" + type + "] Requires a polygon clipping layer");

  // If clipping layer was imported from a second file, it won't be included in
  // dataset
  // (assuming that clipLyr arcs have been merged with dataset.arcs)
  //
  if (utils.contains(srcDataset.layers, clipLyr) === false) {
    dataset = {
      layers: [clipLyr].concat(srcDataset.layers),
      arcs: srcDataset.arcs
    };
  } else {
    dataset = srcDataset;
  }

  if (usingPathClip) {
    nodes = MapShaper.divideArcs(dataset);
  }

  outputLayers = targetLayers.map(function(targetLyr) {
    var clippedShapes, outputLyr;
    if (targetLyr === clipLyr) {
      stop('[' + type + '] Can\'t clip a layer with itself');
    } else if (targetLyr.geometry_type == 'point') {
      clippedShapes = MapShaper.clipPoints(targetLyr.shapes, clipLyr.shapes, dataset.arcs, type);
    } else if (targetLyr.geometry_type == 'polygon') {
      clippedShapes = MapShaper.clipPolygons(targetLyr.shapes, clipLyr.shapes, nodes, type);
    } else if (targetLyr.geometry_type == 'polyline') {
      clippedShapes = MapShaper.clipPolylines(targetLyr.shapes, clipLyr.shapes, nodes, type);
    } else {
      stop('[' + type + '] Invalid target layer:', targetLyr.name);
    }

    if (opts.no_replace) {
      outputLyr = utils.extend({}, targetLyr);
      outputLyr.data = targetLyr.data ? targetLyr.data.clone() : null;
    } else {
      outputLyr = targetLyr;
    }
    outputLyr.shapes = clippedShapes;

    // Remove null shapes (likely removed by clipping/erasing)
    api.filterFeatures(outputLyr, dataset.arcs, {remove_empty: true});
    return outputLyr;
  });

  // Cleanup is set by option parser; use no-cleanup to disable
  if (usingPathClip && opts.cleanup) {
    // Delete unused arcs, merge remaining arcs, remap arcs of retained shapes.
    // This is to remove arcs belonging to the clipping paths from the target
    // dataset, and to heal the cuts that were made where clipping paths
    // crossed target paths
    dataset = {arcs: srcDataset.arcs, layers: srcDataset.layers};
    if (opts.no_replace) {
      dataset.layers = dataset.layers.concat(outputLayers);
    } else {
      MapShaper.replaceLayers(dataset, targetLayers, outputLayers);
    }
    MapShaper.dissolveArcs(dataset);
  }

  return outputLayers;
};

// @src: a layer object, layer identifier or filename
MapShaper.getClipLayer = function(src, dataset, opts) {
  var clipLayers, clipDataset, mergedDataset;
  if (utils.isObject(src)) {
    // src is layer object
    return src;
  }
  // check if src is the name of an existing layer
  if (src) {
    clipLayers = MapShaper.findMatchingLayers(dataset.layers, src);
    if (clipLayers.length > 1) {
      stop("[clip/erase] Received more than one source layer");
    } else if (clipLayers.length == 1) {
      return clipLayers[0];
    }
  }
  if (src) {
    // assuming src is a filename
    clipDataset = MapShaper.readClipFile(src, opts);
    if (!clipDataset) {
      stop("Unable to find file [" + src + "]");
    }
    // TODO: handle multi-layer sources, e.g. TopoJSON files
    if (clipDataset.layers.length != 1) {
      stop("Clip/erase only supports clipping with single-layer datasets");
    }
  } else if (opts.bbox) {
    clipDataset = MapShaper.convertClipBounds(opts.bbox);
  } else {
    stop("[clip/erase] Missing clipping data");
  }
  mergedDataset = MapShaper.mergeDatasets([dataset, clipDataset]);
  api.buildTopology(mergedDataset);

  // use arcs from merged dataset, but don't add clip layer to target dataset
  dataset.arcs = mergedDataset.arcs;
  return clipDataset.layers[0];
};

// @src Filename
MapShaper.readClipFile = function(src, opts) {
  // Load clip file without topology; later merge clipping data with target
  //   dataset and build topology.
  opts = utils.extend(opts, {no_topology: true});
  return api.importFile(src, opts);
};

MapShaper.convertClipBounds = function(bb) {
  var x0 = bb[0], y0 = bb[1], x1 = bb[2], y1 = bb[3],
      arc = [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]];

  if (!(y1 > y0 && x1 > x0)) {
    stop("[clip/erase] Invalid bbox (should be [xmin, ymin, xmax, ymax]):", bb);
  }
  return {
    arcs: new ArcCollection([arc]),
    layers: [{
      shapes: [[[0]]],
      geometry_type: 'polygon'
    }]
  };
};
