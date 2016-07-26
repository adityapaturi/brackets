/*
 * Copyright (c) 2016 - present Adobe Systems Incorporated. All rights reserved.
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
/*global define, WeakMap, Uint32Array, Uint8Array */

define(function (require, exports, module) {
    "use strict";
    var StringUtils = require("utils/StringUtils"),
        _           = require("thirdparty/lodash");

    /**
     * Store document text and index
     * key: {CodeMirror.Doc}
     * value: { text: {string}, index: {Array<number>}, generation: {number} }
     * text = The text of the document
     * index = The document line index for lookups
     * generation = the document history generation number
     */
    var _documentMap = new WeakMap();

    /**
     * Determines if the current document has changed since we last stored the docInfo
     * @param {CodeMirror.Doc} doc
     * @return boolean
     */
    function _needToIndexDocument(doc) {
        var docInfo = _documentMap.get(doc);

        // lastmodtime is not changed when undo is invoked.
        // so we will use the generation count to determine if the document has changed
        if (docInfo && (docInfo.generation === doc.history.generation)) {
            // document has not changed since we indexed
            return false;
        }
        return true;
    }

    /**
     * Creates an array which stores the sum of all characters in the document
     * up to the point of each line.
     * This is needed to efficiently convert character index offsets to position objects of line and character offset.
     * @param {String} text The string to index
     * @param {String} lineSeparator The ending character that splits lines
     */
    function _createLineCharacterCountIndex(text, lineSeparator) {
        var lineNumber;
        // splitting is actually faster than using doc.getLine()
        var lines = text.split(lineSeparator);
        var lineSeparatorLength = lineSeparator.length;
        var lineCharacterCountIndex = new Uint32Array(lines.length);
        var lineCount = lines.length;
        var totalCharacterCount = 0;
        for (lineNumber = 0; lineNumber < lineCount; lineNumber++) {
            totalCharacterCount += lines[lineNumber].length + lineSeparatorLength;
            lineCharacterCountIndex[lineNumber] = totalCharacterCount;
        }
        return lineCharacterCountIndex;
    }

    /**
     * Creates the document index and store in our map
     * @param {CodeMirror.Doc} doc The codemirror document
     */
    function _indexDocument(doc) {
        var docText = doc.getValue();
        var docLineIndex = _createLineCharacterCountIndex(docText, doc.lineSeparator());
        _documentMap.set(doc, {text: docText, index: docLineIndex, generation: doc.history.generation});
    }

    /**
     * Gets the document index
     * @param {CodeMirror.Doc} doc The codemirror document
     * @returns {Array<number>} see '_createLineCharacterCountIndex' for contents of Array
     */
    function _getDocumentIndex(doc) {
        return _documentMap.get(doc).index;
    }

    /**
     * Gets the document text
     * @param {CodeMirror.Doc} doc The codemirror document
     * @returns {String} document text content
     */
    function _getDocumentText(doc) {
        return _documentMap.get(doc).text;
    }


    /**
     * Converts plain text query into regular expression
     * If already regular expression, then just set the flags as appropriate
     * @param {Object}  stringOrRegex A string or regular expression
     * @param {boolean} ignoreCase True to ignore case for searchers
     */
    function _convertToRegularExpression(stringOrRegex, ignoreCase) {
        if (typeof stringOrRegex === "string") {
            return new RegExp(StringUtils.regexEscape(stringOrRegex), ignoreCase ? "igm" : "gm");
        } else {
            return new RegExp(stringOrRegex.source, ignoreCase ? "igm" : "gm");
        }
    }

    /**
     * Finds the line number for the given index
     * @private
     * @param {Array<number>} lineCharacterCountIndexArray See '_createLineCharacterCountIndex'
     * @param {number}        startSearchingWithLine       Line number to start search
     * @param {number}        indexWithinDoc               The index of the character offset from the start of the document
     * @returns {number}      The line number for the given index.
     */
    function _lineFromIndex(lineCharacterCountIndexArray, startSearchingWithLine, indexWithinDoc) {
        var lineNumber;
        var lineCount = lineCharacterCountIndexArray.length;
        // linear search for line number turns out to be usually faster than binary search
        // as matches tend to come relatively close together and we can boost the linear
        // search performance using starting position since we often know our progress through the document.
        for (lineNumber = startSearchingWithLine; lineNumber < lineCount; lineNumber++) {
            // If the total character count at this line is greater than the index
            // then the index must be somewhere on this line
            if (lineCharacterCountIndexArray[lineNumber] > indexWithinDoc) {
                return lineNumber;
            }
        }
    }

    /**
     * Given the character offset from the beginning of the document
     * creates an object which has the position information
     * @param {Array<number>} lineCharacterCountIndexArray See '_createLineCharacterCountIndex'
     * @param {number} startSearchingWithLine Line number to start search
     * @param {number} indexWithinDoc The index of the character offset from the start of the document
     * @return {{line: number, ch: number}} Line and character offsets
     */
    function _createPosFromIndex(lineCharacterCountIndexArray, startSearchingWithLine, indexWithinDoc) {
        var lineNumber = _lineFromIndex(lineCharacterCountIndexArray, startSearchingWithLine, indexWithinDoc);

        var previousLineEndingCharacterIndex = lineNumber > 0 ? lineCharacterCountIndexArray[lineNumber - 1] : 0;
        // create a Pos with the line number and the character offset relative to the beginning of this line
        return {line: lineNumber, ch: indexWithinDoc - previousLineEndingCharacterIndex };
    }

    /**
     * Returns the character offset from the beginning of the document based on
     * object properties as pos.from.line and pos.from.ch
     * where line is the line number in the document and ch is the character offset on the line
     * @param {Array<number>} lineCharacterCountIndexArray See '_createLineCharacterCountIndex'
     * @param {{line: number, ch: number}} pos Object describing the position within the document
     */
    function _indexFromPos(lineCharacterCountIndexArray, pos) {
        var indexAtStartOfLine = 0;
        if (pos.line > 0) {
            // Start with the sum of the character count at the end of previous line
            indexAtStartOfLine = lineCharacterCountIndexArray[pos.line - 1];
        }
        // Add the number of characters offset from the start and return
        return indexAtStartOfLine + pos.ch;
    }

    /**
     * Scans entire document and callback with each match found.
     * Uses the documentIndex to more efficiently create the position objects on found matches.
     *
     * @param {Array<number>} lineCharacterCountIndexArray See '_createLineCharacterCountIndex'
     * @param {String}        documentText                 Text to scan
     * @param {RegExp}        regex                        Regular expression used to search
     * @param {{from: {line: number, ch: number}, to: {line: number, ch: number}}} range Area to scan for matches
     * @param {function({line: number, ch: number}, {line: number, ch: number}, Array )} fnEachMatch Function is called with start position, end position and Regex match Array
     */
    function _scanDocumentUsingRegularExpression(documentIndex, documentText, regex, range, fnEachMatch) {
        var matchArray;
        var startRangeIndex = range !== undefined ? _indexFromPos(documentIndex, range.from) : 0;
        var endRangeIndex = range !== undefined ? _indexFromPos(documentIndex, range.to) : documentIndex[documentIndex.length - 1];

        regex.lastIndex = startRangeIndex;
        var lastMatchedLine = 0;
        while ((matchArray = regex.exec(documentText)) !== null) {
            var startPosition = _createPosFromIndex(documentIndex, lastMatchedLine, matchArray.index);
            var endPosition = _createPosFromIndex(documentIndex, startPosition.line, regex.lastIndex);
            lastMatchedLine = endPosition.line;

            if (regex.lastIndex <= endRangeIndex) {
                fnEachMatch(startPosition, endPosition, matchArray);
            } else {
                break;
            }
            // This is to stop infinite loop.  Some regular expressions can return 0 length match
            // which will not advance the lastindex property.  Ex ".*"
            if (matchArray.index === regex.lastIndex) {
                regex.lastIndex++;
            }
        }
    }


    /**
     * Returns an object that indicates the beginning and end of a match from the search
     * @param {Array<number>} docLineIndex See '_createLineCharacterCountIndex'
     * @param {number}        indexStart   Start location using index
     * @param {number}        indexEnd     End location using index
     * @param {number}        startLine    Starting line to search for line locations
     *
     */
    function _createSearchResult(docLineIndex, indexStart, indexEnd, startLine) {
        if (typeof startLine === 'undefined') {
            startLine = 0;
        }

        var fromPos = _createPosFromIndex(docLineIndex, startLine, indexStart);
        var toPos   = _createPosFromIndex(docLineIndex, fromPos.line, indexEnd);

        return {from: fromPos, to: toPos};
    }

    /**
     * Comparison function for binary search of index positions within document.
     * @param {number} matchIndex First match index for compare
     * @param {number} posIndex   Second match index for compare
     * @returns {number} Result of comparison
     */
    function _compareMatchResultToPos(matchIndex, posIndex) {
        if (matchIndex === posIndex) {
            return 0;
        } else if (matchIndex < posIndex) {
            return -1;
        } else {
            return 1;
        }
    }

    /**
     * Finds the result that is at or nearest the position passed to function.
     * If a match result is not at the position, it will then locate the closest
     * match result which is in the search direction.
     * If there is no match found before the end or beginning of the document
     * then this function returns false.
     * @param {!Object} regexIndexer instance of the regex indexer. see _createRegexIndexer
     * @param {number} pos Starting index position to search from
     * @param {boolean} reverse direction to search.
     * @param {function(number, number)} fnCompare function to compare positions for binary search
     */
    function _findResultIndexNearPos(regexIndexer, pos, reverse, fnCompare) {
        var compare;

        var length = regexIndexer.getItemCount();
        var upperBound = length - 1;
        var lowerBound = 0;
        var searchIndex;
        while (lowerBound <= upperBound) {
            searchIndex = Math.floor((upperBound + lowerBound) / 2);
            compare = fnCompare(regexIndexer.getMatchIndexStart(searchIndex), pos);
            if (compare === 0) {
                return searchIndex;
            } else if (compare === -1) {
                lowerBound = searchIndex + 1;
            } else {
                upperBound = searchIndex - 1;
            }
        }
        // no exact match, we are at the lower bound
        // if going forward return the next index
        if ((compare === -1) && (!reverse)) {
            searchIndex += 1;
        }
        // no exact match, we are at the upper bound
        // if going reverse return the next lower index
        if ((compare === 1) && (reverse)) {
            searchIndex -= 1;
        }

        // If we went beyond the length or start, there was no match and no next index to match
        if ((searchIndex < 0) || (searchIndex >= length)) {
            return false;
        }
        // no exact match, we are already at the closest match in the search direction
        return searchIndex;
    }

    /**
     * Enhances array with functions which facilitate managing the array contents
     * by groups of items.
     * This is useful for both performance and memory consumption to store the indexes
     * of the match result beginning and ending locations.
     * @param {Array} array The array to enhance
     * @param {number} groupSize The number of indices that belong to a group
     * @returns {GroupArray} Enhanced Array
     */
    function _makeGroupArray(array, groupSize) {
        var _currentGroupIndex = -groupSize;
        _.assign(array, {
            nextGroupIndex: function () {
                if (_currentGroupIndex < array.length - groupSize) {
                    _currentGroupIndex += groupSize;
                } else {
                    _currentGroupIndex = -groupSize;
                    return false;
                }
                return _currentGroupIndex;
            },
            prevGroupIndex: function () {
                if (_currentGroupIndex - groupSize > -1) {
                    _currentGroupIndex -= groupSize;
                } else {
                    _currentGroupIndex = -groupSize;
                    return false;
                }
                return _currentGroupIndex;
            },
            setCurrentGroup: function (groupNumber) {_currentGroupIndex = groupNumber * groupSize; },

            getGroupIndex: function (groupNumber) { return groupSize * groupNumber; },
            getGroupValue: function (groupNumber, valueIndexWithinGroup) {return array[(groupSize * groupNumber) + valueIndexWithinGroup]; },
            currentGroupIndex: function () { return _currentGroupIndex; },
            currentGroupNumber: function () { return _currentGroupIndex / groupSize; },
            groupSize: function () { return groupSize; },
            itemCount: function () { return array.length / groupSize; },

        });
        return array;
    }

    /**
     * Performs a search using the supplied RegExp and adds all results
     * of matched locations to the group array
     *
     * @private
     * @param   {object}     query                           regular expression query
     * @param   {String}     docText                         the text to search
     * @param   {GroupArray} groupArray                      group array to hold values of index locations
     * @param   {number}     [matchCountLimit=10000000]      search will stop when match limit met
     * @param   {number}     [searchEndIndex=docText.length] search will stop when last match exceeds index location
     * @returns {number}                                     Count of results
     */
    function _searchAndAddResultsToArray(query, docText, groupArray, matchCountLimit, searchEndIndex) {
        var matchArray;
        var index = 0;
        searchEndIndex = searchEndIndex || docText.length;
        matchCountLimit = matchCountLimit || 10000000;
        matchCountLimit *= groupArray.groupSize();

        while ((matchArray = query.exec(docText)) !== null) {
            groupArray[index++] = matchArray.index;
            groupArray[index++] = query.lastIndex;
            // This is to stop infinite loop.  Some regular expressions can return 0 length match
            // which will not advance the lastindex property.  Ex ".*"
            if (matchArray.index === query.lastIndex) {
                query.lastIndex++;
            }
            if ((index >= matchCountLimit) || (query.lastIndex > searchEndIndex)) {
                break;
            }
        }

        return index / groupArray.groupSize();
    }

    /**
     * Determines if the values of specified items in a group array are equal
     * @private
     * @param   {GroupArray} groupArray1 First group array
     * @param   {GroupArray} groupNum1   Item within group array
     * @param   {GroupArray} groupArray2 Second group array
     * @param   {GroupArray} groupNum2   Item within 2nd group array
     * @returns {boolean}  true when values are equal
     */
    function _isGroupValuesEqual(groupArray1, groupNum1, groupArray2, groupNum2) {
        if (_.isEqual(groupArray1.getGroupValue(groupNum1, 0), groupArray2.getGroupValue(groupNum2, 0)) &&
                _.isEqual(groupArray1.getGroupValue(groupNum1, 1), groupArray2.getGroupValue(groupNum2, 1))) {
            return true;
        }
        return false;
    }

    /**
     * If the first item of the first group array and the last item of the second group array
     * are equal, then remove the duplicate from the end of the second group array
     * @private
     * @param {GroupArray} firstSearchResults  First search results
     * @param {GroupArray} secondSearchResults Second search results
     */
    function _removeIfDuplicateResultOnEdge(firstSearchResults, secondSearchResults) {
        if (firstSearchResults.itemCount() === 0 || secondSearchResults.itemCount() === 0) {
            return;
        }
        if (_isGroupValuesEqual(firstSearchResults, 0, secondSearchResults, secondSearchResults.itemCount() - 1)) {
            secondSearchResults.pop();
            secondSearchResults.pop();
        }
    }

    /**
     * Creates the regex indexer which finds all matches within supplied text using the search query.
     * Uses a lookup index to efficiently map regular expression result indexes to position used by Brackets
     * @param {String} docText       The text to search for matches
     * @param {Array}  docLineIndex  Array used to map indexes to positions
     * @param {RegExp} query         A regular expression used to find matches
     * @param {number} maxResults    The limit of the number of matches to perform
     * @param {{to: {line: number, ch: number}, from: {line: number, ch: number}} startPosition Start searching at this position
     * @returns {RegexIndexer} A new instance of the regular expression indexer
     */
    function _createRegexIndexer(docText, docLineIndex, query, maxResults, startPosition) {
        // Start and End index of each match stored in array as:
        // [0] = start index of first match
        // [1] = end index of first match
        // ...
        // Each pair of start and end is considered a group when using the group array
        var _startEndIndexArray = _makeGroupArray([], 2);
        maxResults = maxResults || 10000000;
        startPosition = startPosition || {to: {line: 0, ch: 0}, from: {line: 0, ch: 0}};

        function nextMatch() {
            var currentMatchIndex = _startEndIndexArray.nextGroupIndex();
            if (currentMatchIndex === false) {
                return false;
            }
            // TODO potentially could be optimized if we could pass in the prev match line for starting search
            // However, seems very fast already for current use case
            return _createSearchResult(docLineIndex, _startEndIndexArray[currentMatchIndex], _startEndIndexArray[currentMatchIndex + 1]);
        }

        function prevMatch() {
            var currentMatchIndex = _startEndIndexArray.prevGroupIndex();
            if (currentMatchIndex === false) {
                return false;
            }
            return _createSearchResult(docLineIndex, _startEndIndexArray[currentMatchIndex], _startEndIndexArray[currentMatchIndex + 1]);
        }

        function getItemByMatchNumber(matchNumber) {
            var groupIndex = _startEndIndexArray.getGroupIndex(matchNumber);
            return _createSearchResult(docLineIndex, _startEndIndexArray[groupIndex], _startEndIndexArray[groupIndex + 1]);
        }

        function forEachMatch(fnMatch) {
            var index;
            var length = _startEndIndexArray.itemCount();
            var lastLine = 0;
            for (index = 0; index < length; index++) {
                var groupIndex = _startEndIndexArray.getGroupIndex(index);
                var fromPos = _createPosFromIndex(docLineIndex, lastLine, _startEndIndexArray[groupIndex]);
                var toPos = _createPosFromIndex(docLineIndex, fromPos.line, _startEndIndexArray[groupIndex + 1]);
                lastLine = toPos.line;
                fnMatch(fromPos, toPos);
            }
        }

        function forEachMatchWithinRange(regexIndexer, startPosition, endPosition, fnResult) {
            var nearestMatchIndex = _findResultIndexNearPos(regexIndexer, _indexFromPos(docLineIndex, startPosition), false, _compareMatchResultToPos);
            if (nearestMatchIndex === false) {return; }

            var nearestMatchPosition = _createPosFromIndex(docLineIndex, startPosition.line, _startEndIndexArray[nearestMatchIndex]);
            if (nearestMatchPosition.line > endPosition.line) {return; }

            var index;
            var length = _startEndIndexArray.itemCount();
            var lastLine = startPosition.line;
            for (index = nearestMatchIndex; index < length; index++) {
                var groupIndex = _startEndIndexArray.getGroupIndex(index);
                var fromPos = _createPosFromIndex(docLineIndex, lastLine, _startEndIndexArray[groupIndex]);
                var toPos = _createPosFromIndex(docLineIndex, fromPos.line, _startEndIndexArray[groupIndex + 1]);
                lastLine = toPos.line;

                // do not return results beyond end range position
                if (fromPos.line > endPosition.line) {return; }

                fnResult(fromPos, toPos);
            }
        }

        function fillWithMatchedLinePattern(patternArray) {
            var index;
            var length = _startEndIndexArray.itemCount();
            var lastLine = 0;
            var linesPerArraySlot = docLineIndex.length / patternArray.length;
            for (index = 0; index < length; index++) {
                var groupIndex = _startEndIndexArray.getGroupIndex(index);
                var fromLine = _lineFromIndex(docLineIndex, lastLine, _startEndIndexArray[groupIndex]);
                lastLine = fromLine;
                patternArray[Math.floor(fromLine / linesPerArraySlot)] = 1;
            }
        }

        function getItemCount() {
            return _startEndIndexArray.itemCount();
        }

        function getCurrentMatch() {
            var currentMatchIndex = _startEndIndexArray.currentGroupIndex();
            if (currentMatchIndex > -1) {
                return _createSearchResult(docLineIndex, _startEndIndexArray[currentMatchIndex], _startEndIndexArray[currentMatchIndex + 1]);
            }
        }

        function getMatchIndexStart(matchNumber) {
            return _startEndIndexArray.getGroupValue(matchNumber, 0);
        }

        function getMatchIndexEnd(matchNumber) {
            return _startEndIndexArray.getGroupValue(matchNumber, 1);
        }

        function setCurrentMatchNumber(number) {
            _startEndIndexArray.setCurrentGroup(number);
        }

        function getCurrentMatchNumber() {
            return _startEndIndexArray.currentGroupNumber();
        }

        function getFullResultInfo(matchNumber, query, docText) {
            var groupIndex = _startEndIndexArray.getGroupIndex(matchNumber);
            query.lastIndex = _startEndIndexArray[groupIndex];
            var matchInfo = query.exec(docText);
            var currentMatch = getCurrentMatch();
            currentMatch.match = matchInfo;
            return currentMatch;
        }



        /**
         * Performs a 2 part search if cursor is not at the beginning of the document.
         * This is done to handle the case for very large documents so that we can reasonably limit
         * the result to some number of matches starting at the cursor location.
         *
         * The first search is done starting at the cursor location and continues until the end
         * of the document.  If we reach the end of the document and we have not exceeded the
         * maximum number of matches, then a second search is done starting at the beginning of the
         * document and combined with the first search.
         *
         * The effect is that this does a complete document search for most documents and only when
         * the document is very large and also the matches are large we will limit starting at the cursor.
         *
         * @private
         * @param   {String} docText    Text to search
         * @param   {Regex}  query      A regular expression
         * @param   {number} startIndex Index location to start search
         * @returns {GroupArray} Array of search results
         */
        function _createSearchResults(docText, query, startIndex) {
            query.lastIndex = startIndex;
            // perform first search at our starting index
            var resultCount = _searchAndAddResultsToArray(query, docText, _startEndIndexArray, maxResults);

            if ((startIndex > 0) && (resultCount < maxResults)) {
                query.lastIndex = 0;
                var startEndIndexFromBeginningOfDocument = _makeGroupArray([], 2);
                _searchAndAddResultsToArray(query, docText, startEndIndexFromBeginningOfDocument, maxResults, startIndex);
                // it is possible that on wrap around the last result is same as our first result
                _removeIfDuplicateResultOnEdge(_startEndIndexArray, startEndIndexFromBeginningOfDocument);
                // combine results of both searches
                _startEndIndexArray = _makeGroupArray(startEndIndexFromBeginningOfDocument.concat(_startEndIndexArray), 2);
            }

            return _startEndIndexArray;
        }
        _createSearchResults(docText, query, _indexFromPos(docLineIndex, startPosition.from));

        return {nextMatch : nextMatch,
                prevMatch : prevMatch,
                getItemByMatchNumber : getItemByMatchNumber,
                getItemCount : getItemCount,
                getCurrentMatch : getCurrentMatch,
                setCurrentMatchNumber : setCurrentMatchNumber,
                getMatchIndexStart : getMatchIndexStart,
                getMatchIndexEnd : getMatchIndexEnd,
                getCurrentMatchNumber : getCurrentMatchNumber,
                getFullResultInfo : getFullResultInfo,
                forEachMatch : forEachMatch,
                forEachMatchWithinRange : forEachMatchWithinRange,
                fillWithMatchedLinePattern : fillWithMatchedLinePattern
            };
    }


    /**
     * Creates a regular expression cursor object that this module will provide to consumers
     * @returns {SearchCursor} A new instance of a search cursor
     */
    function _createCursor() {
        function _findNext(cursor) {
            var match = cursor.regexIndexer.nextMatch();
            if (!match) {
                cursor.atOccurrence = false;
                cursor.currentPosition = null;
                return false;
            }
            return match;
        }
        function _findPrevious(cursor) {
            var match = cursor.regexIndexer.prevMatch();
            if (!match) {
                cursor.atOccurrence = false;
                cursor.currentPosition = null;
                return false;
            }
            return match;
        }

        function _updateResultsIfNeeded(cursor) {
            if (_needToIndexDocument(cursor.doc)) {
                _indexDocument(cursor.doc);
                cursor.resultsCurrent = false;
            }
            if (!cursor.resultsCurrent) {
                cursor.scanDocumentAndStoreResultsInCursor();
            }
        }
        function _setQuery(cursor, query) {
            var newRegexQuery = _convertToRegularExpression(query, cursor.ignoreCase);
            if ((cursor.query) && (cursor.query.source !== newRegexQuery.source)) {
                // query has changed
                cursor.resultsCurrent = false;
            }
            cursor.query = newRegexQuery;
        }
        /**
         * Sets the location of where the search cursor should be located
         * @param {!Object} cursor The search cursor
         * @param {!{line: number, ch: number}} pos The search cursor location
         */
        function _setPos(cursor, pos) {
            pos = pos || {line: 0, ch: 0};
            cursor.currentPosition = {from: pos, to: pos};
        }

        function _startingPositionForFind(cursor, reverse) {
            if (cursor.currentPosition) {return cursor.currentPosition; }
            var position = reverse ? {line: cursor.doc.lineCount(), ch: 0} : {line: 0, ch: 0};
            return {from: position, to: position};
        }

        // Returns all public functions for the cursor
        return _.assign(Object.create(null), {
            /**
             * Sets or updates the document and query properties
             * @param {!{document: CodeMirror.Doc, searchQuery: string|RegExp, position: {line: number, ch: number}, ignoreCase: boolean}} properties
             */
            setSearchDocumentAndQuery: function (properties) {
                this.atOccurrence = false;
                if (properties.ignoreCase) {this.ignoreCase = properties.ignoreCase; }
                if (properties.document) {this.doc = properties.document; }
                if (properties.searchQuery) {_setQuery(this, properties.searchQuery); }
                if (properties.position) {_setPos(this, properties.position); }
                if (properties.maxResults) {this.maxResults = properties.maxResults; }
            },

            /**
             * Gets the total number of characters in the document
             * @return {number}
             */
            getDocCharacterCount: function () {
                _updateResultsIfNeeded(this);
                var docLineIndex = _getDocumentIndex(this.doc);
                return docLineIndex[docLineIndex.length - 1];
            },

            /**
             * Gets the total number of matches
             * @return {number}
             */
            getMatchCount: function () {
                _updateResultsIfNeeded(this);
                return this.regexIndexer.getItemCount();
            },

            /**
             * Gets the current match number counting from the first match.
             * This is a 0 based index count.
             * A match is not selected until find is used to navigate to a match.
             * @return {number} match number or -1 if no match selected.
             */
            getCurrentMatchNumber: function () {
                _updateResultsIfNeeded(this);
                return this.regexIndexer.getCurrentMatchNumber();
            },

            /**
             * Finds the next match in the indicated search direction
             * @param {boolean} reverse true searches backwards. false searches forwards
             * @return {{to: {line: number, ch: number}, from: {line: number, ch: number}}}
             */
            find: function (reverse) {
                _updateResultsIfNeeded(this);
                var foundPosition;
                if (!this.regexIndexer.getCurrentMatch()) {
                    // There is currently no match position
                    // This is our first time or we hit the top or end of document using next or prev
                    this.currentPosition = _startingPositionForFind(this, reverse);
                    var docLineIndex = _getDocumentIndex(this.doc);
                    var matchIndex = _findResultIndexNearPos(this.regexIndexer, _indexFromPos(docLineIndex, this.currentPosition.from), reverse, _compareMatchResultToPos);
                    if (matchIndex) {
                        this.regexIndexer.setCurrentMatchNumber(matchIndex);
                        foundPosition = this.regexIndexer.getCurrentMatch();
                    }
                }
                if (!foundPosition) {
                    foundPosition = reverse ? _findPrevious(this) : _findNext(this);
                }
                if (foundPosition) {
                    this.currentPosition = foundPosition;
                    this.atOccurrence = !(!foundPosition);
                }
                return foundPosition;
            },

            /**
             * Iterates over each result from searching the document calling the function with the start and end positions of each match
             * @param {function({line: number, ch: number}, {line: number, ch: number})} fnResult
             */
            forEachMatch: function (fnResult) {
                _updateResultsIfNeeded(this);
                this.regexIndexer.forEachMatch(fnResult);
            },

            /**
             * Calls the result function for each match that is within the specified range
             * @param {{line: number, ch: number}} startPosition Starting position of range
             * @param {{line: number, ch: number}} endPosition   Ending position of range
             * @param {function} fnResult      called for each match
             */
            forEachMatchWithinRange: function (startPosition, endPosition, fnResult) {
                _updateResultsIfNeeded(this);
                this.regexIndexer.forEachMatchWithinRange(this.regexIndexer, startPosition, endPosition, fnResult);
            },

            /**
             * Gets the start and end positions plus the regular expression match array data
             * @return {{to: {line: number, ch: number}, from: {line: number, ch: number}, match: Array}} returns start and end of match with the array of results
             */
            getFullInfoForCurrentMatch: function () {
                var docText = _getDocumentText(this.doc);
                return this.regexIndexer.getFullResultInfo(this.regexIndexer.getCurrentMatchNumber(), this.query, docText);
            },

            /**
             * Creates an Array of integers which is filled with a pattern matching the lines
             * of the document which contain matches.
             * A value of '0' is no match.
             * A value of '1' is positive match.
             *
             * @param   {[[Type]]} levelOfDetail An Array of this size will be created and filled with a pattern matching lines matched
             * @returns {object}   An array filled with line match pattern
             */
            createMatchedLinePattern: function (levelOfDetail) {
                _updateResultsIfNeeded(this);
                var representationArray = new Uint8Array(levelOfDetail);
                var docLineIndex = _getDocumentIndex(this.doc);
                var linesPerArraySlot = docLineIndex.length / levelOfDetail;
                this.regexIndexer.fillWithMatchedLinePattern(representationArray);
                return {linesPerArraySlot: linesPerArraySlot, lineMatchPatternArray: representationArray};
            },

            /**
             * Finds the indexes of all matches based on the current search query
             * The matches can then be navigated and retrieved using the functions of the search cursor.
             *
             * @return {number} the count of matches found.
             */
            scanDocumentAndStoreResultsInCursor: function () {
                if (_needToIndexDocument(this.doc)) {
                    _indexDocument(this.doc);
                }
                var docText = _getDocumentText(this.doc);
                var docLineIndex = _getDocumentIndex(this.doc);
                this.regexIndexer = _createRegexIndexer(docText, docLineIndex, this.query, this.maxResults, this.currentPosition);
                this.resultsCurrent = true;
                return this.getMatchCount();
            }
        });
    }

    /**
     * Creates an updatable search cursor which can be used to navigate forward and backward through the results.
     *
     * @param {!{document: CodeMirror.Doc, searchQuery: string|RegExp, position: {line: number, ch: number}, ignoreCase: boolean}} properties
     * @return {Object} The search cursor object
     */
    function createSearchCursor(properties) {
        var searchCursor = _createCursor();
        searchCursor.setSearchDocumentAndQuery(properties);
        return searchCursor;
    }

    /**
     * Scans the entire document for regular expression matches and calls fnEachMatch for each found match.
     * Unlike the search cursor, this creates no retained results to be used for back and forward navigation.
     * This is provided for consumers who wish to leverage the speed provided by the document index, but do
     * not need to use the features of a cursor.
     *
     * @param {!{document: CodeMirror.Doc, searchQuery: string|RegExp, ignoreCase: boolean, fnEachMatch: function({line: number, ch: number}, {line: number, ch: number, match: Array})}} properties
     */
    function scanDocumentForMatches(properties) {
        if (_needToIndexDocument(properties.document)) {
            _indexDocument(properties.document);
        }
        var regex = _convertToRegularExpression(properties.searchQuery, properties.ignoreCase);
        _scanDocumentUsingRegularExpression(_getDocumentIndex(properties.document), _getDocumentText(properties.document), regex, properties.range, properties.fnEachMatch);
    }

    exports.createSearchCursor = createSearchCursor;
    exports.scanDocumentForMatches = scanDocumentForMatches;
});
