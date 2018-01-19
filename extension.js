const vscode = require('vscode');
const tmp = require('tmp');
const path = require('path')
const fs = require('fs');
const io = require('socket.io-client');

var SocketSyncController = (function () {
    const config = vscode.workspace.getConfiguration('telescope');
    var host = config.get('host');
    var socket;

    var EVENTS = {
        CONNECTION: 'connection',
        ADD_DOC: 'add doc',
        CHANGE_DOC: 'change doc',
        CHANGE_SELECTION: 'change selection',
        CREATE_SESSION: 'create session',
        ECHO: 'echo',
        ECHO_SESSION: 'echo session',
        JOIN_SESSION: 'join session',
        SET_NAME: 'set name',
        SET_SESSION: 'set session',
        REJECT_JOIN: 'reject join',
        SET_DOC_ID: 'set doc id',
        USER_JOINED: 'joined'
    };

    function SocketSyncController() {
        var subscriptions = [];
        this.files = {};
        this.session = '';
        this.tempDir = '';
        this.socketEventsInitialized = false;
        this.belayChange = false;
        this.name = config.get('username');
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.statusBar.command = 'telescope.connectToHost';
        this.statusBar.text = '🔭 Telescope Initializing...';

        this.statusBar.show();

        var subscriptions = [
            vscode.commands.registerCommand('telescope.createSession', this.createSession, this),
            vscode.commands.registerCommand('telescope.joinSession', this.joinSession, this),
            vscode.commands.registerCommand('telescope.addDocument', this.addDoc, this),
            vscode.commands.registerCommand('telescope.setName', this.setName, this),
            vscode.commands.registerCommand('telescope.connectToHost', this.connectToHost, this),
            vscode.commands.registerCommand('telescope.disconnectFromHost', this.disconnectFromHost, this),
            vscode.commands.registerCommand('telescope.changeHost', this.changeHost, this)
        ];

        vscode.workspace.onDidChangeTextDocument(this._onDocumentChanged, this, subscriptions);
        vscode.window.onDidChangeTextEditorSelection(this._onSelectionChange, this, subscriptions);
        this._disposable = vscode.Disposable.from.apply(vscode.Disposable, subscriptions);

        this.connectToHost();

    }

    SocketSyncController.prototype.disconnectFromHost = function () {
        var _this = this;
        vscode.window.showInformationMessage('Disconnecting will end any current sessions.  Really disconnect?', 'Yes', 'No').then(function (res) {
            if (res === 'Yes') {
                socket.disconnect();
                _this.statusBar.text = '🔭 Telescope Inactive';
            }
        });
    }

    SocketSyncController.prototype.connectToHost = function () {
        var _this = this;

        if (typeof socket !== 'undefined' && socket.connected) {
            socket.disconnect();
        }

        this.statusBar.text = '🔭 Telescope Connecting...';

        socket = io(host);
        
        socket.on('connect', function(){
            if (!_this.socketEventsInitialized) {
                _this.initializeSocketEvents();
            }
            socket.emit(EVENTS.SET_NAME, {
                name: _this.name
            });
            _this.statusBar.text = '🔭 Telescope Active';
        });

        socket.on('connect_error', function(){
            _this.statusBar.text = '🔭 Telescope Inactive';
        });

    }

    SocketSyncController.prototype.initializeSocketEvents = function () {
        var _this = this;

        socket.on(EVENTS.ADD_DOC, function (data) {
            _this._onAddDoc(data);
        });

        socket.on(EVENTS.CHANGE_DOC, function (data) {
            _this._onChangeDoc(data);
        });

        socket.on(EVENTS.SET_SESSION, function (data) {
            _this._onSetSession(data);
        });

        socket.on(EVENTS.SET_DOC_ID, function (data) {
            _this._onSetDocId(data);
        });

        socket.on(EVENTS.CHANGE_SELECTION, function (data) {
            _this._onChangeSelection(data);
        });

        socket.on(EVENTS.USER_JOINED, function (data) {
            _this._onUserJoined(data);
        });
    }

    /**
     * Document Events
     */
    SocketSyncController.prototype._onSelectionChange = function (event) {
        if (this.isInSession()) {
            socket.emit(EVENTS.CHANGE_SELECTION, {
                selections: event.selections,
                fileId: this.files[event.textEditor.document.fileName],
                fileName: event.textEditor.document.fileName
            });
        }
    }

    SocketSyncController.prototype._onDocumentChanged = function (event) {
        if (this.isInSession()) {
            if (this.belayChange) {
                this.belayChange = false;
                return false;
            }

            socket.emit(EVENTS.CHANGE_DOC, {
                changeEvent: event.contentChanges,
                fileId: this.files[event.document.fileName],
                fileName: event.document.fileName
            });
        }
    }

    /**
     * Socket Events
     */
    SocketSyncController.prototype._onChangeSelection = function (data) {
        if (this.isInSession()) {

            for (var i = 0; i < vscode.window.visibleTextEditors.length; i++) {
                var editor = vscode.window.visibleTextEditors[i];

                if (this.files[editor.document.fileName] == data.fileId) {
                    if (typeof editor.userSelections === 'undefined') {
                        editor.userSelections = {};
                    }

                    if (typeof editor.userSelections[data.name] === 'undefined') {
                        editor.userSelections[data.name] = vscode.window.createTextEditorDecorationType({
                            backgroundColor: 'rgba(255,0,0,.65)',
                            border: '1px solid red'
                        });
                    }

                    var ranges = data.selections.map(function (item) {
                        var start = new vscode.Position(item.start.line - 1, item.start.character - 1);
                        var end = new vscode.Position(item.end.line - 1, item.end.character - 1);
                        return new vscode.Range(start, end);
                    });

                    editor.setDecorations(editor.userSelections[data.name], ranges);

                }
            }
        }
    }

    SocketSyncController.prototype._onUserJoined = function (data) {
        vscode.window.showInformationMessage(data.name + " joined session.");
    }

    SocketSyncController.prototype._onSetDocId = function (data) {
        this.files[data.fileName] = data.fileId;
    }

    SocketSyncController.prototype.getDocURIById = function (id) {
        var fileName = false;

        for (var file in this.files) {
            if (this.files[file] == id)
                fileName = file;
        }

        var doc = vscode.workspace.textDocuments.find(function (item) {
            return item.fileName == fileName;
        });

        if (doc) {
            return doc.uri;
        } else {
            return false;
        }
    }

    SocketSyncController.prototype._onSetSession = function (data) {
        this.session = data.session;
        vscode.window.showInformationMessage("Entered Session: " + this.session);
    }

    SocketSyncController.prototype._onAddDoc = function (data) {
        var _this = this;
        var fileName = this.tempDir + path.sep + data.fileName;
        fs.writeFileSync(fileName, data.text);

        vscode.workspace.openTextDocument(fileName).then(function (document) {
            _this.files[document.fileName] = data.fileId;
            vscode.window.showTextDocument(document);
        });
    }

    SocketSyncController.prototype._onChangeDoc = function (data) {
        this.belayChange = true;
        var changeEvent = data.changeEvent[0];
        var start = new vscode.Position(changeEvent.range[0].line, changeEvent.range[0].character);
        var end = new vscode.Position(changeEvent.range[1].line, changeEvent.range[1].character);
        var range = new vscode.Range(start, end);
        var edit = new vscode.TextEdit(range, data.changeEvent[0].text);
        var doc = this.getDocURIById(data.fileId);

        if (doc) {
            var wsEdit = new vscode.WorkspaceEdit();
            wsEdit.set(doc, [edit]);
            vscode.workspace.applyEdit(wsEdit);
        }
    }

    /**
     * Commands
     */
    SocketSyncController.prototype.createSession = function () {
        if (this.isInSession()) {
            this.tempDir = tmp.dirSync().name;
            socket.emit(EVENTS.CREATE_SESSION);
        }
    }

    SocketSyncController.prototype.addDoc = function () {
        if (this.isInSession()) {
            var doc = vscode.window.activeTextEditor.document;
            if (!doc.isUntitled) {
                socket.emit(EVENTS.ADD_DOC, {
                    fileName: doc.fileName,
                    text: doc.getText()
                });
            }
        }
    }

    SocketSyncController.prototype.changeHost = function () {
        var _this = this;
        vscode.window.showInputBox({
            prompt: 'Please enter the host URL.'
        }).then(function (host) {
            host = host;
            config.update('host', host);
            _this.connectToHost();
        });
    }

    SocketSyncController.prototype.setName = function () {
        var _this = this;
        vscode.window.showInputBox({
            prompt: 'Please enter a user name.'
        }).then(function (name) {
            _this.name = name;

            config.update('username', name);
            if (_this.isInSession()) {
                socket.emit(EVENTS.SET_NAME, {
                    name: _this.name
                });
            }
        });
    }

    SocketSyncController.prototype.joinSession = function () {
        if (socket.connected) {
            var _this = this;
            this.tempDir = tmp.dirSync().name;

            vscode.window.showInputBox({
                prompt: 'Please enter your Session ID.'
            }).then(function (sessionId) {
                _this.session = sessionId;
                socket.emit('join session', {
                    session: sessionId
                })
            });
        }
    }

    SocketSyncController.prototype.leaveSession = function () {
        if (this.isInSession()) {
            this.files = [];
            this.session = [];
            socket.emit('leave session');
        }
    }

    /**
     * Helper functions
     */
    SocketSyncController.prototype.isInSession = function () {
        return (socket.connected) && (this.session != '')
    };

    SocketSyncController.prototype.dispose = function () {
        this._disposable.dispose();
    }

    return SocketSyncController;
}())

function activate(context) {
    let myPlugin = new SocketSyncController();
    context.subscriptions.push(myPlugin);
}

function deactivate() {
    // Empty
}

exports.activate = activate;
exports.deactivate = deactivate;