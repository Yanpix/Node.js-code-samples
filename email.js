var config = require('config');
var nodemailer = require('nodemailer');
var log = require('logger')(module).sub('EMAIL');
var _ = require('underscore');
var Promise = require('bluebird');
var models = require('pgdb/models');

function Email() {
    "use strict";

    var emailObj = this;

    emailObj.data = {};
    emailObj.data.subject = '';
    emailObj.data.html = '';
    emailObj.data.from = config.properties.emails.activationFrom;
    emailObj.data.reply_to = '';
    emailObj.data.to = '';
    emailObj.data.cc = '';

    /**
     * Set value to the data variable which will be sent with email
     * @param key
     * @param val
     * @returns {Email}
     */
    emailObj.set = function (key, val) {
        if (_.isObject(key)) {
            emailObj.data = _.extend(emailObj.data, key);
        } else if (_.isString(key)) {
            emailObj.data[key] = val;
        } else {
            throw 'Key should be a string or object!'
        }
        return this;
    };

    /**
     * Fetch template and returns Promise
     * @param templateName
     * @param templateData
     * @param md
     * @returns {*}
     */
    function getTemplateByName(templateName, templateData, md) {
        if (!_.isString(templateName) || !templateName.length) {
            throw 'templateName should be a string';
        }
        templateData || (templateData = {});

        return new models.app_sitetemplate()
            .query(function (qb) {
                qb.where({template_name: templateName})
            })
            .fetch()
            .then(function (Template) {
                return Template.getContent(templateData, md);
            });
    }

    /**
     * Set subject from existing template
     * @param templateName
     * @param templateData
     * @param md
     * @returns {*}
     */
    emailObj.setSubjectFromTemplate = function (templateName, templateData, md) {
        return getTemplateByName.apply(this, arguments)
            .then(function (subjectFromTemplate) {
                return emailObj.set('subject', subjectFromTemplate);
            });
    };

    /**+
     * Set body from existing template
     * @param templateName
     * @param templateData
     * @param md
     * @returns {*}
     */
    emailObj.setBodyFromTemplate = function (templateName, templateData, md) {
        return getTemplateByName.apply(this, arguments)
            .then(function (bodyFromTemplate) {
                return emailObj.set('html', bodyFromTemplate);
            });
    };

    /**
     * Send email
     */
    emailObj.send = function () {
        var transporter = nodemailer.createTransport();
        var mailOptions = emailObj.data;

        // send mail with defined transport object
        return transporter.sendMail(mailOptions, function (error, info) {
            if (error) {
                console.error(error);
            } else {
                console.log('Message sent: ' + info.response);
            }
        });
    };

    return emailObj;
}

module.exports.Email = Email;