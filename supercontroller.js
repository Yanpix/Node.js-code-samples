var imCb = require('sysx-utils').immedCb;
var async = require('async');
var ce = require('cloneextend');
var _ = require('underscore');
var events = require('events');
var util = require('util');
var scUtils = require('lib/super-controller/scutils');
var MprError = require('errors');

function bind(fn, scope) {
    return function () {
        fn.apply(scope, arguments);
    };
}

function SuperController(options) {
    events.EventEmitter.call(this);

    this.self = this;
    this.options = ce.cloneextend(options);
    this.options.recordsLimit = 100;
    this.options.hideFields = ['password'];
    this.options.baseUri = '/api/v1.0';
    this.options.log = require('logger')(module).sub('api').sub('controller');

    this.withRelated = [];
    this.withAdditionalColumns = true;


    var self = this;

    this.verbs = [
        {
            objM: self.table,
            method: 'get',
            uriPart: 'table'
        },
        {
            objM: self.editForm,
            method: 'get',
            needId: true,
            uriPart: 'edit'
        },
        {
            objM: self.newForm,
            method: 'get',
            uriPart: 'new'
        },
        {
            objM: self.newObject,
            method: 'post',
            uriPart: 'new'
        },
        {
            objM: self.editObject,
            method: 'post',
            uriPart: 'edit',
            needId: true
        },
        {
            objM: self.patch,
            method: 'patch'
        },
        {
            objM: self.index,
            method: 'get'
        },
        {
            objM: self.create,
            method: 'post'
        },
        {
            objM: self.show,
            method: 'get',
            needId: true
        },
        {
            objM: self.update,
            method: 'put',
            needId: true
        },
        {
            objM: self.destroy,
            method: 'delete',
            needId: true
        },
        {
            objM: self.state,
            method: 'head'
        }
    ];
}

util.inherits(SuperController, events.EventEmitter);

/**
 * Registers methods for verbs
 * @param app
 * @param authMiddleware
 */
SuperController.prototype.register = function (app, authMiddleware) {
    var self = this;

    _.each(this.verbs, function (def) {
        var idParam = def.needId ? '/:id' : '';
        idParam += def.uriPart ? '/' + def.uriPart : '';
        app[def.method](self.options.baseUri + '/' + self.options.resourceName + idParam, authMiddleware, bind(def.objM, self));
    });
};

SuperController.prototype.query = function (protoQuery, request, callback) {
    imCb(callback, null, protoQuery);
};

SuperController.prototype.beforeShowQuery = function (request, originalQuery, callback) {
    imCb(callback, null, originalQuery);
};

SuperController.prototype.prepareShowQuery = function (request, query, callback) {
    callback(null, query);
};

SuperController.prototype.index = function (request, response) {
    var _self = this;
    var replacements = request.filterQuery ? request.filterQuery.replacements || {} : {};

    if (request.filterQuery) {
        _self.withAdditionalColumns = request.filterQuery.withAdditionalColumns === undefined ? true : request.filterQuery.withAdditionalColumns == 'true';
        delete request.filterQuery.withAdditionalColumns;
        delete request.filterQuery.replacements;
    } else {
        _self.withAdditionalColumns = true;
    }
    var limit = scUtils.getRequestParameter(request, 'limit', 25) * 1;
    if (limit < 0) limit *= -1;

    var offset = scUtils.getRequestParameter(request, 'offset', 0) * 1;
    if (offset < 0) offset *= -1;

    var requestWithRelated = scUtils.getRequestParameter(request, 'withRelated');
    if (_.isArray(requestWithRelated)) {
        _self.withRelated = requestWithRelated;
    } else if (_.isBoolean(requestWithRelated) && requestWithRelated === true) {
        _self.withRelated = _self.options.withRelated || [];
    } else if (requestWithRelated === undefined) {
        _self.withRelated = _self.options.withRelated || [];
    }

    if (request.filterQuery && request.filterQuery.include) {
        request.query.include = request.filterQuery.include;
        delete request.filterQuery.include;
    }

    async.waterfall(
        [
            /* run child query overridden method */
            function (cb) {
                _self.query(request.filterQuery || {}, request, cb);
            },
            /*count query*/
            function (itemQuery, callback) {
                //remove possibly putted withRelated variable
                if (itemQuery.withRelated)
                    delete itemQuery.withRelated;

                var countQuery = new _self.options.model().query();
                /* build joins part */
                scUtils.buildJoins(countQuery, _self.options.entity.joinRules, false);
                /* build where part*/
                scUtils.buildWherePart(countQuery, itemQuery, _self.options.entity);
                /* build full text search part */
                scUtils.buildSearchPart(countQuery, request, itemQuery, _self);
                var idAttribute = _self.options.idAttribute || 'id';
                countQuery
                    .count(_self.options.entity.mainTable + '.' + idAttribute)
                    .groupBy(_self.options.entity.mainTable + '.' + idAttribute)
                    .then(function (countQueryRes) {
                        callback(null, itemQuery, countQueryRes.length);
                    },
                    function (err) {
                        console.log(err);
                        callback(err);
                    }
                );
            },
            /*main select query*/
            function (itemQuery, count, callback) {

                var fetchOptions = {
                    withRelated: _self.withRelated
                };
                /* which columns to select from main table */
                if (!_.isUndefined(_self.options.entity.mainTableColumns)) {
                    fetchOptions = _.extend(fetchOptions, {
                        columns: _self.options.entity.mainTableColumns
                    });
                    fetchOptions.columns = scUtils.excludeFields(fetchOptions.columns, _self);
                }

                var collection = _self.options.model.collection();
                collection.query(function (qb) {
                    if (limit !== 0) qb.limit(limit);
                    qb.offset(offset);
                    /* build additional columns */
                    scUtils.buildAdditionalColumns(qb, _self, replacements || {});
                    /* build joins */
                    scUtils.buildJoins(qb, _self.options.entity.joinRules, true);
                    /* build where part*/
                    scUtils.buildWherePart(qb, itemQuery, _self.options.entity);
                    /* full text search and search with LIKE */
                    scUtils.buildSearchPart(qb, request, itemQuery, _self);
                    /* build order part */
                    scUtils.builtOrderPart(qb, request.query.sort, _self.options.entity.sortingFields);
                    /* build include part */
                    scUtils.includeFields(qb, request.query.include, _self.options.entity.availableIncludeFields);
                }).fetch(fetchOptions).then(function (resCollection) {
                    callback(null, count, resCollection);
                }).catch(function (err) {
                    "use strict";
                    callback(err);
                });
            }
        ],
        function (err, count, resCollection) {
            if (err) {
                new MprError(500, null, {
                    error: err,
                    stack: err.stack
                }).send(response);
            } else {
                async.waterfall(
                    [function (ub) {
                        _self.beforeSend(resCollection, ub);
                    }],
                    function (err, result) {
                        if (err) {
                            new MprError(404).send();
                        } else {
                            response.status(200).json({
                                objects: resCollection.toJSON(),
                                meta: {
                                    count: count,
                                    display: count,
                                    nextPage: limit > 0 ? offset * limit : 0,
                                    currentPage: limit > 0 ? offset : 0,
                                    pageSize: limit > 0 ? limit : count
                                }
                            });
                        }
                    }
                );
            }
        }
    );
};

SuperController.prototype.show = function (request, response) {
    var _self = this;
    var id = request.params.id;
    var replacements = !!request.filterQuery ? request.filterQuery.replacements || {} : {};
    if (request.filterQuery) {
        _self.withAdditionalColumns = request.filterQuery.withAdditionalColumns === undefined ? true : request.filterQuery.withAdditionalColumns == 'true';
        delete request.filterQuery.withAdditionalColumns;
        delete request.filterQuery.replacements;
    } else {
        _self.withAdditionalColumns = true;
    }

    async.waterfall([
            function (callback) {
                _self.query(request.filterQuery || {}, request, callback);
            },
            function (query, callback) {
                imCb(_self.beforeShowQuery, request, query, callback);
            },
            function (query, cb) {
                var keysFromOtherModels = [],
                    objectOfOtherModelKeys = {},
                    keysFromNativeModel = [],
                    objectQuery = {};

                query = _.extend(query, {
                    'id': id
                });

                if (isNaN(query.id)) {
                    cb(null, null);
                    return;
                }

                keysFromOtherModels = _.filter(Object.keys(query), function (key) {
                    "use strict";
                    return key.split('.').length === 2 && key !== _self.options.entity.mainTable;
                });
                _.each(keysFromOtherModels, function (key) {
                    "use strict";
                    objectOfOtherModelKeys[key] = query[key];
                });
                keysFromNativeModel = _.filter(Object.keys(query), function (key) {
                    "use strict";
                    return key.split('.').length !== 2;
                });
                _.each(keysFromNativeModel, function (key) {
                    "use strict";
                    objectQuery[key] = query[key];
                });

                var model = new _self.options.model(objectQuery);

                var fetchParams = {};
                var requestWithRelated = scUtils.getRequestParameter(request, 'withRelated');
                if (requestWithRelated) {
                    _self.withRelated = requestWithRelated === "false" ? [] : _self.options.withRelated;
                } else if (_self.options.withRelated) {
                    _self.withRelated = _self.options.withRelated;
                }

                if (_self.withRelated) {
                    fetchParams.withRelated = _self.withRelated;
                }

                model.query(function (qb) {
                    /* build additional columns */
                    scUtils.buildAdditionalColumns(qb, _self, replacements);
                    /* build joins */
                    scUtils.buildJoins(qb, _self.options.entity.joinRules, true);

                    for(var k in objectOfOtherModelKeys) {
                        qb.where(k, '=', objectOfOtherModelKeys[k]);
                    }
                });


                model.fetch(fetchParams).then(function (model) {
                    cb(null, model);
                });
            }],
        function (err, result) {
            _self.sendOne(err, 200, response, result, _self.beforeShowSend);
        }
    );
};

SuperController.prototype.beforeSend = function (result, callback) {
    callback(null, result);
};

SuperController.prototype.beforeShowSend = function (request, response, result, callback) {
    imCb(callback, null, result);
};

SuperController.prototype.sendOne = function (error, status, response, result, beforeSend) {
    var _self = this;

    if (error) {
        _self.log.error(error);
        response.send(500, null, {
            error: error,
            stack: error.stack
        });
    } else if (!result) {
        response.send(404);
    } else {
        async.waterfall([
                function (q) {
                    if (_.isFunction(beforeSend)) {
                        imCb(beforeSend, status, response, result, q);
                    } else {
                        imCb(null, q);
                    }
                },
                function (result) {
                    response.status(status).json(result);
                }],
            function (err) {
                if (err) {
                    _self.log.error(err);
                }
            }
        );
    }

};

/**
 * Deletes item
 * @param request
 * @param response
 */
SuperController.prototype.destroy = function (request, response) {
    var id = request.params.id;
    this.modelId = id;
    var _self = this;
    async.waterfall([
            function (cb) {
                "use strict";
                if (id == request.user.id) {
                    cb('You are trying to remove yourself! Don\'t do that!');
                } else {
                    cb();
                }
            },
            function (cb) {
                _self.query(request.filterQuery || {}, request, cb);
            },
            function (query, cb) {
                imCb(_self.beforeDestroyQuery, request, query, cb);
            },
            function (query, cb) {
                var fetchParams = {};
                if (_self.options.withRelated) {
                    fetchParams.withRelated = _self.options.withRelated;
                }

                _self.options.model.collection().query(function (qb) {
                    scUtils.buildWherePart(qb, _.extend(query, {
                        'id': id
                    }));
                }).fetchOne(fetchParams).then(function (model) {
                    if (_.isNull(model)) {
                        cb('Error on fetching chosen model');
                    } else {
                        _self.options.destroedModel = _.clone(model.attributes);
                        _self.options.destroedM = _.clone(model);
                        _self.destroyRelated(model, cb);
                    }
                });
            },
            function (model, cb) {
                var modelAttributes = model.attributes;
                if (model.doNotDestroyMain && model.doNotDestroyMain === true) {
                    _self.afterDestroyed(modelAttributes, cb);
                } else {
                    model.destroy().then(function () {
                        _self.afterDestroyed(modelAttributes, cb);
                    })
                }
            }],
        function (err, result) {
            _self.sendNone(err, 204, response, result, _self.beforeDestroySend);
        });
};

SuperController.prototype.beforeDestroyQuery = function (request, originalQuery, callback) {
    imCb(callback, null, originalQuery);
};

SuperController.prototype.prepareDestroyQuery = function (request, query, callback) {
    callback(null, query);
};

SuperController.prototype.afterDestroyed = function (modelAttributes, callback) {
    imCb(callback);
};

SuperController.prototype.destroyRelated = function (model, callback) {
    callback(null, model);
};

SuperController.prototype.beforeDestroySend = function (request, response, result, callback) {
    imCb(callback, null, result);
};

SuperController.prototype.create = function (request, response) {
    var _self = this;
    async.waterfall([
            /* prepare data for models */
            function (cb) {
                _self.prepareData({}, request, request.body, false, cb);
            },
            /* prepare models */
            function (query, data, cb) {
                _self.prepareModels(_self.options.model, {}, request, data, cb);
            },
            /* save models */
            function (model, relatedModels, data, cb) {
                model.save({}, {
                    method: 'insert'
                })
                    .otherwise(function (errors) {
                        throw errors;
                    })
                    .then(function (model) {
                        _self.afterCreate(model, relatedModels, request, cb);
                    })
            }
        ],
        //final callback to send client response
        function (err, result) {
            if (err) {
                response.send(400, err);
            } else {
                response.json(200, result);
            }
        }
    );
};

/**
 * Prepares data before sending queries to save data
 * @param query
 * @param request
 * @param data
 * @param callback
 */
SuperController.prototype.prepareData = function (query, request, data, update, callback) {
    var preparedData = scUtils.collectModelsData(data, this.options.entity.modelsAttributes);
    callback(null, query, preparedData);
};

SuperController.prototype.prepareModels = function (model, query, request, data, callback) {
    model.set(data);
    callback(null, model, [], data);
};

/**
 * Using after data saved
 * @param model
 * @param data - user request data
 * @param cb callback function
 */
SuperController.prototype.afterCreate = function (model, relatedModels, data, cb) {
    cb(null, model);
};

SuperController.prototype.state = function (request, response) {
    response.send(501, 'Not implemented');
};

SuperController.prototype.sendNone = function (error, status, response, beforeSend) {
    var _self = this;

    if (error) {
        if (_self.log) _self.log.error(error);
        new MprError(400, _.isString(error) ? error : null).send(response);
    } else {
        async.waterfall([
            function (q) {
                if (_.isFunction(beforeSend)) {
                    imCb(beforeSend, status, response, result, q);
                } else {
                    imCb(q, null);
                }
            },
            function (result, q) {
                response.send(status);
            }], function (err, result) {
            if (err) {
                if (_self.log) _self.log.error(err);
            }
        });
    }

};

/**
 * **************************************
 * START OF - methods to Update One Thing
 * **************************************
 */

SuperController.prototype.update = function (request, response) {
    var id = request.params.id;
    var _self = this;

    async.waterfall([
            function (cb) {
                new _self.options.model({
                    id: id
                })
                    .fetch()
                    .then(function (Model) {
                        if (Model) {
                            cb();
                        } else {
                            _self.create(request, response);
                        }
                    }).catch(function (err) {
                        cb(err);
                    });
            },
            //call overridden query method by child controller or call not overridden dummy query method
            function (cb) {
                _self.query(request.filterQuery || {}, request, cb);
            },
            function (query, cb) {
                _self.prepareData(query, request, request.body, true, cb);
            },
            function (query, data, cb) {

                var fetchParams = {};
                if (_self.options.withRelated) {
                    fetchParams.withRelated = _self.options.withRelated;
                }

                _self.options.model.collection().query(function (qb) {
                    scUtils.buildWherePart(qb, _.extend(query, {
                        'id': id
                    }));
                }).fetchOne(fetchParams).then(function (model) {
                    _self.prepareModels(model, query, request, data, cb);
                });
            },
            function (model, relatedModels, data, cb) {
                _self.beforeSave(model, relatedModels, request.body, cb);
            },
            function (model, relatedModels, data, cb) {
                model.save()
                    .catch(function (errors) {
                        cb(errors);
                    }).then(function (model) {

                        if (relatedModels) {
                            // update related models
                            async.forEachSeries(relatedModels, function (m, forEachSeriesCallback) {
                                m.save().then(function (m) {
                                    forEachSeriesCallback(null);
                                })
                            }, function (err) {
                                //final callback
                                cb(null, model, relatedModels, data);
                            })
                        } else {
                            cb(null, model, relatedModels, data);
                        }
                    })
            },
            function (model, relatedModels, data, cb) {
                _self.afterSave(model, data, cb);
            }
        ],
        function (err, result) {
            if (err) {
                response.status(400).json(['Opps']);
            } else {
                response.status(200).json(200, result);
            }
        });
};

SuperController.prototype.beforeSave = function (model, relatedModels, data, callback) {
    callback(null, model, relatedModels, data);
};

SuperController.prototype.afterSave = function (model, data, callback) {
    callback(null, model);
};


module.exports.SuperController = SuperController;
