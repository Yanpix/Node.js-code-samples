/**
 * @name ResponseErrorObject
 * @property {Number} errorType
 * @property {String} message
 * @property {Object} body
 */

var Promise = require('bluebird'),
    log = require('logger')(module).sub('API');
var Validator = require('bookshelf-validator'),
    ValidationError = Validator.ValidationError;
var SagePayError = require('lib/payments/sagepay').Error;
var PayPalError = require('lib/payments/paypal/error');
var choices = require('pgdb/choices');
var APIErrors = require('lib/APIErrors');
var models = require("../pgdb/models.js");

var errorTypes = choices.ERROR_TYPES;

/**
 *
 * @param type
 * @param message
 * @param body
 * @return {ResponseErrorObject}
 */
var errorBody = function (type, message, body) {
    return {
        errorType: type,
        message: message || '',
        body: body || {}
    };
};

module.exports = {
    create: function (fn) {
        var method = Promise.method(fn);

        return function (request, response) {
            return method.call(this, request, response)
                .catch(APIErrors.AuthError, function (error) {

                    request.session.faultTries || (request.session.faultTries = 0);
                    request.session.faultTries++;

                    response.status(401).json(errorBody(errorTypes.auth, error));
                })
                .catch(ValidationError, function (error) {
                    response.status(400).json(errorBody(errorTypes.validation, error.message));
                })
                .catch(APIErrors.ResourceNotFound, function () {
                    response.status(404).json(errorBody(errorTypes.not_found, 'Resource not found!'));
                })
                .catch(APIErrors.ForbiddenError, function (error) {
                    response.status(403).json(errorBody(errorTypes.denied, error.message, error.body));
                })
                .catch(APIErrors.BusinessLogicError, function (message) {
                    response.status(400).json(errorBody(errorTypes.business, message.message));
                })
                .catch(SagePayError, function (error) {
                    log.sub('SagePayError').error({
                        url: request.url,
                        body: request.body,
                        user: request.user,
                        params: request.params,
                        query: request.query,
                        error: error,
                        stack: error.body
                    });
                    response.status(400).json(errorBody(errorTypes.business, 'Error occurs with SagePay.', error.body));
                })
                .catch(PayPalError, function (error) {
                    log.sub('PayPalError').error({
                        url: request.url,
                        body: request.body,
                        user: request.user,
                        params: request.params,
                        query: request.query,
                        error: error,
                        stack: error.body
                    });
                    response.status(400).json(errorBody(errorTypes.pay_pal, 'Error occurs with PayPal.'));
                })
                .catch(function (error) {
                    new models.app_logs().save({
                        request_url: request.url,
                        request_body: request.body,
                        user_id: request.user.id,
                        request_params: request.params,
                        request_query: request.query,
                        error: error.message,
                        stack: error.stack
                    }).then(function () {
                        response.status(400).json(errorBody(errorTypes.server, 'Error!'));
                    });
                });
        }
    },

    middleware: function (fn) {
        var method = Promise.method(fn);

        return function (request, response, next) {
            return method(request, response)
                .then(function () {
                    next();
                })
                .catch(APIErrors.AuthError, function (error) {

                    request.session.faultTries || (request.session.faultTries = 0);
                    request.session.faultTries++;

                    response.status(401).json(errorBody(errorTypes.auth, error));
                })
                .catch(APIErrors.BusinessLogicError, function (message) {
                    response.status(400).json(errorBody(errorTypes.business, message.message));
                })
                .catch(APIErrors.ForbiddenError, function (error) {
                    response.status(403).json(errorBody(errorTypes.denied, error.message, error.body));
                })
                .catch(function (error) {
                    // 500 error
                    console.error(error.stack);
                    log.sub(request.url).error({
                        url: request.url,
                        body: request.body,
                        user: request.user,
                        params: request.params,
                        query: request.query,
                        error: error,
                        stack: error.stack
                    });
                    response.status(400).json(errorBody(errorTypes.server, 'Error!'));
                });
        }
    },

    createCronTask: function (fn) {
        var method = Promise.method(fn);
        var fnName = /^function\s+([\w\$]+)\s*\(/.exec(fn.toString())[1];

        return function () {
            var args = [].slice.apply(arguments);
            var callback = args[0] || function () {
                };

            return method.apply(null, args)
                .catch(function (error) {
                    log.sub(fnName).error(error.stack);
                    callback();
                })
                .then(function () {
                    callback();
                });
        }

    }
};