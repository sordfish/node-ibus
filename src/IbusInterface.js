var SerialPort = require("serialport");
var fs = require('fs'),
    Log = require('log'),
    log = new Log('info'),
    log2 = new Log('debug', fs.createWriteStream('my.log'));
    clc = require('cli-color');


var util = require('util');
var EventEmitter = require('events').EventEmitter;

var IbusProtocol = require('./IbusProtocol.js');
var IbusDevices = require('./IbusDevices.js');

var IbusInterface = function(devicePath) {

    // self reference
    var _self = this;

    // exposed data
    this.getInterface = getInterface;
    this.initIBUS = initIBUS;
    this.closeIBUS = closeIBUS;
    this.startup = startup;
    this.shutdown = shutdown;
    this.sendMessage = sendMessage;

    // local data
    var serialPort;
    var device = devicePath;
    var parser;
    var lastActivityTime = process.hrtime();
    var queue = [];


    // implementation
    function initIBUS() {
        serialPort = new SerialPort(device, {
            autoOpen: false,
            baudrate: 9600,
            parity: 'even',
            stopbits: 1,
            databits: 8,
            rtscts: true,
            parser: SerialPort.parsers.raw
        });

        serialPort.open(function(error) {
            if (error) {
                log.error('[IbusInterface] Failed to open: ' + error);
            } else {
                log.info('[IbusInterface] Port Open [' + device + ']');

                serialPort.on('data', function(data) {
                    //log.debug('[IbusInterface] Data on port: ', data);

                    lastActivityTime = process.hrtime();
                });

                serialPort.on('error', function(err) {
                    log.error("[IbusInterface] Error", err);
                    shutdown(startup);
                });

                parser = new IbusProtocol();
                parser.on('message', onMessage);

                serialPort.pipe(parser);

                //watchForEmptyBus(processWriteQueue);
            }
        });

    }


    function isItSafeToSend(){

        serialPort.get((err, status) => {
            if (err) {
                log.error('[IbusInterface] serial.get error:' + err);
                return;
            }
            return status.cts;
        });      
    }

    function processWriteQueue() {
        // noop on empty queue
        if (queue.length <= 0 && !isItSafeToSend() ) {
            // try again
            processWriteQueue();
            return;
        }

        // process 1 message
        var dataBuf = queue.pop();

        log.debug(clc.blue('[IbusInterface] Write queue length: '), queue.length);

        serialPort.write(dataBuf, function(error, resp) {
            if (error) {
                log.error('[IbusInterface] Failed to write: ' + error);
            } else {
                log.info('[IbusInterface] ', clc.white('Wrote to Device: '), dataBuf, resp);

                serialPort.drain(function(error) {
                    log.debug(clc.white('Data drained'));

                    //ready();
                });
            }

        });
    }

    function closeIBUS(callb) {
        serialPort.close(function(error) {
            if (error) {
                log.error('[IbusInterface] Error closing port: ', error);
                callb();
            } else {
                log.info('[IbusInterface] Port Closed [' + device + ']');
                parser = null;
                callb();
            }
        });
    }

    function getInterface() {
        return serialPort;
    }

    function startup() {
        initIBUS();
    }

    function shutdown(callb) {
        log.info('[IbusInterface] Shutting down Ibus device..');
        closeIBUS(callb);
    }

    function onMessage(msg) {
        log.debug('[IbusInterface] Raw Message: ', msg.src, msg.len, msg.dst, msg.msg, '[' + msg.msg.toString('ascii') + ']', msg.crc);

        _self.emit('data', msg);
    }

    function sendMessage(msg) {

        var dataBuf = IbusProtocol.createIbusMessage(msg);
        log.debug('[IbusInterface] Send message: ', dataBuf);

        if (queue.length > 1000) {
            log.warning('[IbusInterface] Queue too large, dropping message..', dataBuf);
            return;
        }

        queue.unshift(dataBuf);

        processWriteQueue();
    }

};

util.inherits(IbusInterface, EventEmitter);
module.exports = IbusInterface;