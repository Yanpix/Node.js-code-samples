var util = require('util');
var _ = require('underscore');


var ReadableBufferStream = function(buffer, opts) {
    var self = this;

    if(!Buffer.isBuffer(buffer)) {
        throw "buffer parameter must be a Buffer instance";
    }
    stream.Readable.call(this);    
    this.buffer = buffer;
    this.amtRead = 0;
}

util.inherits(ReadableBufferStream, stream.Readable);

ReadableBufferStream.prototype._read = function(size) {
    var _r = 0;
    if(size) {
        _r = size > this.buffer.length ? this.buffer.length : size
    } else {
        _r = this.buffer.length; 
    }
    
    var dta = null;

    if((this.amtRead + _r) <= this.buffer.length) {
        
        dta = new Buffer(_r);
        this.buffer.copy(dta, 0, this.amtRead, this.amtRead + size);
        this.amtRead += _r;
    }
    this.push(dta);

};


var WritableBufferStream = function(opts) {
    var self = this;
    stream.Writable.call(this);
    this.buffer = new Buffer(0);
    this.amtWrite = 0;   
}

util.inherits(WritableBufferStream, stream.Writable);

WritableBufferStream.prototype._write = function(chunk, encoding, callback) {
    
    if(!chunk) {
        throw "Nothing to write, chunk param is null";
    }
    
    if(!callback) {
        throw "No callback is given";
    }
    
    // let's do write
    
    this.buffer = Buffer.concat([this.buffer, chunk]);
    
    this.amtWrite += this.buffer.length;
    callback();
};


WritableBufferStream.prototype.getContent = function() {
    return this.buffer;
}


module.exports.ReadableBufferStream = ReadableBufferStream;
module.exports.WritableBufferStream = WritableBufferStream;