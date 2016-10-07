/*
    Font activation on load based on code from:
        http://www.filamentgroup.com/lab/font-events.html (Copyright (c) 2015 Filament Group)
    
    Dependencies:
    - FontFaceObserver https://github.com/bramstein/fontfaceobserver
    
    For the best performance and experience, add the `activeClass`
    class to the `<html>` element on the server side after checking
    for the presence of the `activeCookie` cookie.
*/
(function (w) {
    'use strict';
    
    var fonts = {
            'gt-pressura-mono': [
                { 'weight': 400 },
                { 'weight': 400, 'style': 'italic' },
                { 'weight': 700 },
                { 'weight': 700, 'style': 'italic' },
            ],
            'gt-sectra': [
                { 'weight': 400 },
                { 'weight': 400, 'style': 'italic' },
            ]
        },
        activeClass = 'wf-active',
        activeCookie = 'hamon-wf-cached',
        observers = [];
    
    // hasClass polyfill from http://youmightnotneedjquery.com/#has_class
    function hasClass(el, className) {
        if (el.classList) {
            return el.classList.contains(className);
        }
        return new RegExp('(^| )' + className + '( |$)', 'gi').test(el.className);
    }
    
    // if the class is already set, we're good.
    if (hasClass(w.document.documentElement, activeClass)) {
        return;
    }
    
    // if the fonts are already cached by the browser, activate them
    if (isSessionStorageSupported() && sessionStorage.getItem(activeCookie)) {
        w.document.documentElement.className += ' ' + activeClass;
        return;
    }
    
    Object.keys(fonts).forEach(function (fontFamily) {
        fonts[fontFamily].forEach(function (fontProperties) {
            var new_observer = new w.FontFaceObserver(fontFamily, fontProperties);
            observers.push(new_observer.load(null, 5*60*1000)); // give it 5 mins before timing out
        });
    });
    
    w.Promise
        .all(observers)
        .then(function() {
            // add a class to the document indicating the fonts have loaded
            w.document.documentElement.className += ' ' + activeClass;
            
            // set a flag to optimise future visits
            if (isSessionStorageSupported()) {
                sessionStorage.setItem(activeCookie, true);
            }
        });
}(this));



// Init Instantlinks
InstantClick.init();
