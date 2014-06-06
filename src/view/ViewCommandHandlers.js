/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, window, $ */

/**
 * The ViewCommandHandlers object dispatches the following event(s):
 *    - fontSizeChange -- Triggered when the font size is changed via the
 *      Increase Font Size, Decrease Font Size, or Restore Font Size commands.
 *      The 2nd arg to the listener is the amount of the change. The 3rd arg
 *      is a string containing the new font size after applying the change.
 */
define(function (require, exports, module) {
    "use strict";

    var Commands            = require("command/Commands"),
        CommandManager      = require("command/CommandManager"),
        KeyBindingManager   = require("command/KeyBindingManager"),
        Strings             = require("strings"),
        ProjectManager      = require("project/ProjectManager"),
        EditorManager       = require("editor/EditorManager"),
        PreferencesManager  = require("preferences/PreferencesManager"),
        DocumentManager     = require("document/DocumentManager"),
        ThemeSettings       = require("view/ThemeSettings"),
        AppInit             = require("utils/AppInit");


    /**
     * @const
     * @type {string}
     */
    var DYNAMIC_FONT_STYLE_ID = "codemirror-dynamic-fonts";

    /**
     * @const
     * @private
     * The smallest font size in pixels
     * @type {number}
     */
    var MIN_FONT_SIZE = 1;

    /**
     * @const
     * @private
     * The largest font size in pixels
     * @type {number}
     */
    var MAX_FONT_SIZE = 72;

    /**
     * @const
     * @private
     * The default font size used only to convert the old fontSizeAdjustment view state to the new fontSizeStyle
     * @type {number}
     */
    var DEFAULT_FONT_SIZE = 12;


    /**
     * @private
     * Removes the styles used to update the font size
     */
    function _removeDynamicFontSize() {
        $("#" + DYNAMIC_FONT_STYLE_ID).remove();
    }

    /**
     * @private
     * Add the styles used to update the font size
     * @param {string} fontSizeStyle  A string with the font size and the size unit
     */
    function _addDynamicFontSize(fontSizeStyle) {
        var style = $("<style type='text/css'></style>").attr("id", DYNAMIC_FONT_STYLE_ID);
        style.html(".CodeMirror { font-size: " + fontSizeStyle   + " !important; }");
        $("head").append(style);
    }

    /**
     * @private
     * Sets the font size and restores the scroll position as best as possible.
     * @param {string=} fontSizeStyle  A string with the font size and the size unit
     */
    function _setSizeAndRestoreScroll(fontSizeStyle) {
        var editor      = EditorManager.getCurrentFullEditor(),
            oldWidth    = editor._codeMirror.defaultCharWidth(),
            oldFontSize = $(".CodeMirror").css("font-size"),
            newFontSize = "",
            delta       = 0,
            adjustment  = 0,
            scrollPos   = editor.getScrollPos(),
            line        = editor._codeMirror.lineAtHeight(scrollPos.y, "local");

        _removeDynamicFontSize();
        if (fontSizeStyle) {
            _addDynamicFontSize(fontSizeStyle);
        }
        editor.refreshAll();

        delta = /em$/.test(oldFontSize) ? 10 : 1;
        newFontSize = $(".CodeMirror").css("font-size");
        adjustment = parseInt((parseFloat(newFontSize) - parseFloat(oldFontSize)) * delta, 10);

        if (adjustment) {
            $(exports).triggerHandler("fontSizeChange", [adjustment, newFontSize]);
        }

        // Calculate the new scroll based on the old font sizes and scroll position
        var newWidth   = editor._codeMirror.defaultCharWidth(),
            deltaX     = scrollPos.x / oldWidth,
            scrollPosX = scrollPos.x + Math.round(deltaX * (newWidth  - oldWidth)),
            scrollPosY = editor._codeMirror.heightAtLine(line, "local");

        editor.setScrollPos(scrollPosX, scrollPosY);
    }

    /**
     * @private
     * Increases or decreases the editor's font size.
     * @param {number} adjustment  Negative number to make the font smaller; positive number to make it bigger
     * @return {boolean} true if adjustment occurred, false if it did not occur
     */
    function _adjustFontSize(adjustment) {
        var fsStyle   = $(".CodeMirror").css("font-size"),
            validFont = /^[\d\.]+(px|em)$/;

        // Make sure that the font size is expressed in terms we can handle (px or em). If not, simply bail.
        if (fsStyle.search(validFont) === -1) {
            return false;
        }

        // Guaranteed to work by the validation above.
        var fsUnits = fsStyle.substring(fsStyle.length - 2, fsStyle.length),
            delta   = fsUnits === "px" ? 1 : 0.1,
            fsOld   = parseFloat(fsStyle.substring(0, fsStyle.length - 2)),
            fsNew   = fsOld + (delta * adjustment),
            fsStr   = fsNew + fsUnits;

        // Don't let the font size get too small or too large. The minimum font size is 1px or 0.1em
        // and the maximum font size is 72px or 7.2em depending on the unit used
        if (fsNew < MIN_FONT_SIZE * delta || fsNew > MAX_FONT_SIZE * delta) {
            return false;
        }

        _setSizeAndRestoreScroll(fsStr);
        PreferencesManager.setViewState("fontSizeStyle", fsStr);

        return true;
    }

    /** Increases the font size by 1 */
    function _handleIncreaseFontSize() {
        _adjustFontSize(1);
    }

    /** Decreases the font size by 1 */
    function _handleDecreaseFontSize() {
        _adjustFontSize(-1);
    }

    /** Restores the font size to the original size */
    function _handleRestoreFontSize() {
        _setSizeAndRestoreScroll();
        PreferencesManager.setViewState("fontSizeStyle");
    }


    /**
     * @private
     * Updates the user interface appropriately based on whether or not a document is
     * currently open in the editor.
     */
    function _updateUI() {
        if (DocumentManager.getCurrentDocument() !== null) {
            if (!CommandManager.get(Commands.VIEW_INCREASE_FONT_SIZE).getEnabled()) {
                // If one is disabled then they all are disabled, so enable them all
                CommandManager.get(Commands.VIEW_INCREASE_FONT_SIZE).setEnabled(true);
                CommandManager.get(Commands.VIEW_DECREASE_FONT_SIZE).setEnabled(true);
                CommandManager.get(Commands.VIEW_RESTORE_FONT_SIZE).setEnabled(true);
            }
        } else {
            // No current document so disable all of the Font Size commands
            CommandManager.get(Commands.VIEW_INCREASE_FONT_SIZE).setEnabled(false);
            CommandManager.get(Commands.VIEW_DECREASE_FONT_SIZE).setEnabled(false);
            CommandManager.get(Commands.VIEW_RESTORE_FONT_SIZE).setEnabled(false);
        }
    }

    /**
     * Restores the font size using the saved style and migrates the old fontSizeAdjustment
     * view state to the new fontSizeStyle, when required
     */
    function restoreFontSize() {
        var fsStyle      = PreferencesManager.getViewState("fontSizeStyle"),
            fsAdjustment = PreferencesManager.getViewState("fontSizeAdjustment");

        if (fsAdjustment) {
            // Always remove the old view state even if we also have the new view state.
            PreferencesManager.setViewState("fontSizeAdjustment");

            if (!fsStyle) {
                // Migrate the old view state to the new one.
                fsStyle = (DEFAULT_FONT_SIZE + fsAdjustment) + "px";
                PreferencesManager.setViewState("fontSizeStyle", fsStyle);
            }
        }

        if (fsStyle) {
            _removeDynamicFontSize();
            _addDynamicFontSize(fsStyle);
        }
    }



    /**
     * @private
     * Calculates the first and last visible lines of the focused editor
     * @param {number} textHeight
     * @param {number} scrollTop
     * @param {number} editorHeight
     * @return {{first: number, last: number}}
     */
    function _getLinesInView(textHeight, scrollTop, editorHeight) {
        var scrolledTop    = scrollTop / textHeight,
            scrolledBottom = (scrollTop + editorHeight) / textHeight;

        // Adjust the last line to round inward to show a whole lines.
        var firstLine      = Math.ceil(scrolledTop),
            lastLine       = Math.floor(scrolledBottom) - 1;

        return { first: firstLine, last: lastLine };
    }

    /**
     * @private
     * Scroll the viewport one line up or down.
     * @param {number} direction -1 to scroll one line up; 1 to scroll one line down.
     */
    function _scrollLine(direction) {
        var editor        = EditorManager.getCurrentFullEditor(),
            textHeight    = editor.getTextHeight(),
            cursorPos     = editor.getCursorPos(),
            hasSelecction = editor.hasSelection(),
            inlineEditors = editor.getInlineWidgets(),
            scrollInfo    = editor._codeMirror.getScrollInfo(),
            paddingTop    = editor._getLineSpaceElement().offsetTop,
            editorHeight  = scrollInfo.clientHeight,
            scrollTop     = scrollInfo.top - paddingTop,
            removedScroll = paddingTop;

        // Go through all the editors and reduce the scroll top and editor height to properly calculate the lines in view
        var line, coords;
        inlineEditors.forEach(function (inlineEditor) {
            line   = editor._getInlineWidgetLineNumber(inlineEditor);
            coords = editor._codeMirror.charCoords({line: line, ch: 0}, "local");

            if (coords.top < scrollInfo.top) {
                scrollTop     -= inlineEditor.info.height;
                removedScroll += inlineEditor.info.height;

            } else if (coords.top + inlineEditor.info.height < scrollInfo.top + editorHeight) {
                editorHeight -= inlineEditor.info.height;
            }
        });

        // Calculate the lines in view
        var linesInView = _getLinesInView(textHeight, scrollTop, editorHeight);

        // If there is no selection move the cursor so that is always visible.
        if (!hasSelecction) {
            // Move the cursor to the first visible line.
            if (cursorPos.line < linesInView.first) {
                editor.setCursorPos({line: linesInView.first + direction, ch: cursorPos.ch});

            // Move the cursor to the last visible line.
            } else if (cursorPos.line > linesInView.last) {
                editor.setCursorPos({line: linesInView.last + direction, ch: cursorPos.ch});

            // Move the cursor up or down using moveV to keep the goal column intact, since setCursorPos deletes it.
            } else if ((direction > 0 && cursorPos.line === linesInView.first) ||
                    (direction < 0 && cursorPos.line === linesInView.last)) {
                editor._codeMirror.moveV(direction, "line");
            }
        }

        // Scroll and make it snap to lines
        var lines = linesInView.first + direction;
        editor.setScrollPos(scrollInfo.left, (textHeight * lines) + removedScroll);
    }

    /** Scrolls one line up */
    function _handleScrollLineUp() {
        _scrollLine(-1);
    }

    /** Scrolls one line down */
    function _handleScrollLineDown() {
        _scrollLine(1);
    }

    /** Open theme settings dialog */
    function _handleThemeSettings() {
        ThemeSettings.showDialog();
    }

    /**
     * @private
     * Convert the old "fontSizeAdjustment" preference to the new view state.
     *
     * @param {string} key  The key of the preference to be examined for migration
     *      of old preferences. Not used since we only have one in this module.
     * @param {string} value  The value of "fontSizeAdjustment" preference
     * @return {Object} JSON object for the new view state equivalent to
     *      the old "fontSizeAdjustment" preference.
     */
    function _convertToNewViewState(key, value) {
        return { "fontSizeStyle": (DEFAULT_FONT_SIZE + value) + "px" };
    }

    // Register command handlers
    CommandManager.register(Strings.CMD_INCREASE_FONT_SIZE, Commands.VIEW_INCREASE_FONT_SIZE,  _handleIncreaseFontSize);
    CommandManager.register(Strings.CMD_DECREASE_FONT_SIZE, Commands.VIEW_DECREASE_FONT_SIZE,  _handleDecreaseFontSize);
    CommandManager.register(Strings.CMD_RESTORE_FONT_SIZE,  Commands.VIEW_RESTORE_FONT_SIZE,   _handleRestoreFontSize);
    CommandManager.register(Strings.CMD_SCROLL_LINE_UP,     Commands.VIEW_SCROLL_LINE_UP,      _handleScrollLineUp);
    CommandManager.register(Strings.CMD_SCROLL_LINE_DOWN,   Commands.VIEW_SCROLL_LINE_DOWN,    _handleScrollLineDown);
    CommandManager.register(Strings.CMD_THEMES,             Commands.CMD_THEMES_OPEN_SETTINGS, _handleThemeSettings);

    PreferencesManager.convertPreferences(module, {"fontSizeAdjustment": "user"}, true, _convertToNewViewState);

    // Update UI when opening or closing a document
    $(DocumentManager).on("currentDocumentChange", _updateUI);

    // Update UI when Brackets finishes loading
    AppInit.appReady(_updateUI);

    exports.restoreFontSize = restoreFontSize;
});
