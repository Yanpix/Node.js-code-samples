var events = require('events');
var util = require('util');
var async = require('async');
var log = require('logger')(module).sub('QUEUE');
var crypto = require('crypto');
var _ = require('underscore');

function Queue(num_workers) {
	events.EventEmitter.call(this);

	this.worker = function(task, callback) {
		// simple launch function closure?
		task(callback);
	};

	this.queue = async.queue(this.worker, num_workers);

}

util.inherits(Queue, events.EventEmitter);

Queue.prototype.push = function(task, qModule, callback) {
	var id = crypto.createHash('md5').update(qModule).update(Math.random().toString()).digest('hex');
	
	this.queue.push(task, function() {
		if(_.isFunction(callback)) {
			callback();
		}
		log.info('Task id ' + id + ' came from ' + qModule + ' finished');

	});
	log.info('Task id ' + id + ' came from ' + qModule + ' enqueued');
};

Queue.prototype.length = function() {
    return this.queue.length();
};

var concurrencyLimit = 10;

module.exports = (function(concurrency) {
	var q = new Queue(concurrency);
	return q;
})(concurrencyLimit);
