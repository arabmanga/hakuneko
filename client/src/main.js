const electron = require( 'electron' );
const path = require( 'path' );
const url = require( 'url' );
const config = require( './config.js' );
const cache = require( './cache.js' );

// global reference to the main window
var win = null;

/**
 * 
 */
function info() {
    let separator = '------------------------';
    console.log();
    console.log( separator );
    console.log( 'Framework Version Info' );
    console.log( separator );
    console.log( 'Electron :', process.versions.electron );
    console.log( 'Chrome   :', process.versions.chrome );
    console.log( 'Node     :', process.versions.node );
    console.log( separator );
    console.log();
}

/**
 * Register a custom file protocol handler that will open files from the given directory
 * @param {*} protocol 
 * @param {*} directory 
 */
function registerCacheProtocol( protocol, directory ) {
    electron.protocol.registerFileProtocol( protocol, ( request, callback ) => {
        // build full path (replace backslashes by forward slashes)
        callback( { path: path.normalize( path.join( directory, url.parse( request.url ).pathname ) ) } );
    } );
}
/**
 * 
 * @param {*} win 
 */
function setupBeforeSendHeaders( win ) {
    // inject headers before a request is made (call the handler in the webapp to do the dirty work)
    electron.session.defaultSession.webRequest.onBeforeSendHeaders( ['http*://*'], ( details, callback ) => {
        Promise.resolve()
        .then( () => {
            // prevent from injecting javascript into the webpage while the webcontent is not yet ready
            // => required for loading initial page over http protocol (e.g. local hosted test page)
            if( win && win.webContents && !win.webContents.isLoading() ) {
                // inject javascript: looks stupid, but is a working solution to call a function
                // directly within the render process (without dealing with ipcRenderer)
                let payload = Buffer.from( JSON.stringify( details ) ).toString( 'base64' );
                return win.webContents.executeJavaScript( `Engine.Request.onBeforeSendHeadersHandler('${payload}');` );
            } else {
                throw new Error( 'Cannot inject javascript while web-application is not yet ready!' );
            }
        } )
        .then( result => {
            callback( {
                cancel: false,
                requestHeaders: result.requestHeaders
            } );
        } )
        .catch( error => {
            //console.warn( error );
            callback( {
                cancel: false,
                requestHeaders: details.requestHeaders
            } );
        } );
    } );
}

/**
 * 
 * @param {*} win 
 */
function setupHeadersReceived( win ) {
    electron.session.defaultSession.webRequest.onHeadersReceived( ['http*://*'], ( details, callback ) => {
        Promise.resolve()
        .then( () => {
            // prevent from injecting javascript into the webpage while the webcontent is not yet ready
            // => required for loading initial page over http protocol (e.g. local hosted test page)
            if( win && win.webContents && !win.webContents.isLoading() ) {
                // inject javascript: looks stupid, but is a working solution to call a function
                // directly within the render process (without dealing with ipcRenderer)
                let payload = Buffer.from( JSON.stringify( details ) ).toString( 'base64' );
                return win.webContents.executeJavaScript( `Engine.Request.onHeadersReceivedHandler('${payload}');` );
            } else {
                throw new Error( 'Cannot inject javascript while web-application is not yet ready!' );
            }
        } )
        .then( result => {
            callback( {
                cancel: false,
                responseHeaders: result.responseHeaders
                // statusLine
            } );
        } )
        .catch( error => {
            //console.error( error );
            callback( {
                cancel: false,
                responseHeaders: details.responseHeaders
                // statusLine
            } );
        } );
    } );
}

/**
 * Open and configure the main window of the application
 */
function activateWindow() {

    if ( win !== null ) {
        return;
    }

    registerCacheProtocol( config.cache.url.protocol, config.cache.directory );

    win = new electron.BrowserWindow( {
        width: 1120,
        height: 680,
        webPreferences: {
            experimentalFeatures: true,
            nodeIntegration: true,
            webSecurity: false // required to open local images in browser
        }
    } );

    setupBeforeSendHeaders( win );
    setupHeadersReceived( win );
    win.setTitle( 'HakuNeko' );
    win.setMenu( null );

    let load = () => {
        win.loadURL( config.cache.url.href );
        if( config.app.developer ) {
            win.webContents.openDevTools();
        }
    };

    cache.update( config.app.url.href, config.cache.directory )
    .then( version => {
        load();
        electron.dialog.showMessageBox( win, {
            type: 'info',
            message: 'HakuNeko has been updated\nrev.' + version,
            buttons: ['OK']
        }, ( button, checkbox ) => {} );
    } )
    .catch( error => {
        load();
        if( error ) {
            console.error( error );
        }
    } );

    win.on( 'closed', () => {
        // close all existing windows
        electron.BrowserWindow.getAllWindows().forEach( window => window.close() );
        win = null;
    } );
}

/**
 * Quit aplication, except for OSX
 */
function closeWindow () {
    electron.app.quit();
}

/************************
 *** MAIN ENTRY POINT ***
 ************************/

info();

// Disabling GPU acceleration to possibly prevent chromiums 'blank screen' bug
// it seems the --disable-gpu flag did not solve problems for windows user (blank screen)
// => no need to disable gpu if it still not solves the problem ...
//electron.app.disableHardwareAcceleration();

// add HakuNeko's application directory to the environment variable path (make ffmpeg available on windows)
process.env.PATH += ( process.platform === 'win32' ? ';' : ':' ) + path.dirname( process.execPath );

// register new protocol handler as standard handler to host files locally without web server
// see: https://fossies.org/linux/electron/atom/browser/api/atom_api_protocol.cc
// => required to enable access to chromium specific features such as local store, indexedDB, ...
// { standard, secure, bypassCSP, corsEnabled, supportFetchAPI, allowServiceWorkers }
electron.protocol.registerSchemesAsPrivileged( [
    { scheme: config.cache.url.protocol, privileges: { standard: true } },
    { scheme: 'connector', privileges: { standard: true, supportFetchAPI: true } }
] );

// update userdata path (e.g. for portable version)
electron.app.setPath( 'userData', config.app.userdata );

// connect events
//electron.app.addEventListener(;
electron.app.on( 'ready', activateWindow );
electron.app.on( 'activate', activateWindow );
electron.app.on( 'window-all-closed', closeWindow );

// ignore certificate error (e.g. invalid date)
electron.app.on( 'certificate-error', ( event, webContents, url, error, certificate, callback ) => {
    event.preventDefault();
    callback( true );
} );

electron.app.on( 'browser-window-blur', () => electron.globalShortcut.unregister( 'F11' ) );
electron.app.on( 'browser-window-focus', () => electron.globalShortcut.register( 'F11', () => win.setFullScreen( !win.isFullScreen() ) ) );