/**
 * Robust parser for Bilibili's __pinia obfuscated data
 * Extracts video data by parsing the function body and mapping parameters to values
 * This approach is resilient to parameter name changes and position shifts
 */

function parsePiniaData(htmlContent) {
    console.log('Starting robust pinia parser');
    console.log('HTML content length:', htmlContent.length);
    
    // 1. Extract the entire function by finding window.__pinia and parsing with brace/paren counting
    const piniaIndex = htmlContent.indexOf('window.__pinia');
    if (piniaIndex === -1) {
        console.log('Could not find window.__pinia in content');
        return [];
    }
    
    // Find the opening ( after the =
    const eqIndex = htmlContent.indexOf('=', piniaIndex);
    let startIndex = eqIndex + 1;
    while (startIndex < htmlContent.length && /\s/.test(htmlContent[startIndex])) {
        startIndex++;
    }
    
    if (htmlContent[startIndex] !== '(') {
        console.log('Expected ( after window.__pinia=');
        return [];
    }
    
    // Extract the IIFE: (function(...){...})(...)
    // We need to find where the outer parens close
    let parenDepth = 0;
    let endIndex = startIndex;
    for (let i = startIndex; i < htmlContent.length; i++) {
        if (htmlContent[i] === '(') parenDepth++;
        if (htmlContent[i] === ')') {
            parenDepth--;
            if (parenDepth === 0) {
                endIndex = i;
                break;
            }
        }
    }
    
    const fullIIFE = htmlContent.substring(startIndex + 1, endIndex); // Remove outer parens
    console.log('Extracted IIFE, length:', fullIIFE.length);
    
    // Now we have: function(...){...})(...)
    // Find where "function" starts
    const functionKeywordIndex = fullIIFE.indexOf('function');
    if (functionKeywordIndex === -1) {
        console.log('Could not find function keyword');
        return [];
    }
    
    // Find the opening ( for parameters
    const paramStartIndex = fullIIFE.indexOf('(', functionKeywordIndex);
    let paramEndIndex = paramStartIndex;
    parenDepth = 0;
    for (let i = paramStartIndex; i < fullIIFE.length; i++) {
        if (fullIIFE[i] === '(') parenDepth++;
        if (fullIIFE[i] === ')') {
            parenDepth--;
            if (parenDepth === 0) {
                paramEndIndex = i;
                break;
            }
        }
    }
    
    const paramNamesStr = fullIIFE.substring(paramStartIndex + 1, paramEndIndex);
    
    // Find the function body { ... }
    const bodyStartIndex = fullIIFE.indexOf('{', paramEndIndex);
    let bodyEndIndex = bodyStartIndex;
    let braceDepth = 0;
    for (let i = bodyStartIndex; i < fullIIFE.length; i++) {
        if (fullIIFE[i] === '{') braceDepth++;
        if (fullIIFE[i] === '}') {
            braceDepth--;
            if (braceDepth === 0) {
                bodyEndIndex = i;
                break;
            }
        }
    }
    
    const functionBody = fullIIFE.substring(bodyStartIndex + 1, bodyEndIndex);
    
    // Find the arguments: everything after })(...)
    const argsStartIndex = fullIIFE.indexOf('(', bodyEndIndex);
    const argsString = fullIIFE.substring(argsStartIndex + 1).trim();
    
    console.log('Extracted parameters, body, and arguments successfully');
    
    // 2. Parse parameter names
    const paramNames = paramNamesStr.split(',').map(p => p.trim()).filter(p => p);
    console.log(`Found ${paramNames.length} parameter names`);
    
    // 3. Parse argument values
    const args = parseArguments(argsString);
    console.log(`Parsed ${args.length} argument values`);
    
    if (paramNames.length !== args.length) {
        console.warn(`Parameter count (${paramNames.length}) doesn't match argument count (${args.length})`);
    }
    
    // 4. Create parameter -> value mapping
    const paramMap = {};
    paramNames.forEach((param, index) => {
        if (index < args.length) {
            paramMap[param] = args[index];
        }
    });
    
    console.log(`Created parameter map with ${Object.keys(paramMap).length} entries`);
    
    // 5. Extract video objects from the function body
    const videos = extractVideosFromFunctionBody(functionBody, paramMap);
    
    console.log(`Successfully extracted ${videos.length} videos`);
    return videos;
}

function parseArguments(argsString) {
    const args = [];
    let current = '';
    let inString = false;
    let stringChar = null;
    let depth = 0;
    let escaping = false;
    
    for (let i = 0; i < argsString.length; i++) {
        const char = argsString[i];
        
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }
        
        if (char === '\\') {
            escaping = true;
            current += char;
            continue;
        }
        
        if ((char === '"' || char === "'") && !escaping) {
            if (!inString) {
                inString = true;
                stringChar = char;
                current += char;
            } else if (char === stringChar) {
                inString = false;
                stringChar = null;
                current += char;
            } else {
                current += char;
            }
            continue;
        }
        
        if (inString) {
            current += char;
            continue;
        }
        
        if (char === '{' || char === '[') {
            depth++;
            current += char;
        } else if (char === '}' || char === ']') {
            depth--;
            current += char;
        } else if (char === ',' && depth === 0) {
            const value = parseValue(current.trim());
            args.push(value);
            current = '';
        } else {
            current += char;
        }
    }
    
    if (current.trim()) {
        args.push(parseValue(current.trim()));
    }
    
    return args;
}

function parseValue(str) {
    if (!str) return null;
    
    if (str === 'null') return null;
    if (str === 'undefined') return undefined;
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'void 0') return undefined;
    
    // Handle quoted strings
    if ((str.startsWith('"') && str.endsWith('"')) || 
        (str.startsWith("'") && str.endsWith("'"))) {
        let unquoted = str.slice(1, -1);
        
        // Handle escape sequences
        unquoted = unquoted
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\\\/g, '\\')
            .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
            })
            .replace(/\\x([0-9a-fA-F]{2})/g, (match, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
            });
        
        return unquoted;
    }
    
    // Handle numbers
    if (/^-?\d+$/.test(str)) {
        return parseInt(str, 10);
    }
    
    if (/^-?\d+\.\d+$/.test(str)) {
        return parseFloat(str);
    }
    
    // Handle objects/arrays (though we mostly won't see these in args)
    if (str.startsWith('{') || str.startsWith('[')) {
        try {
            return JSON.parse(str);
        } catch (e) {
            return str;
        }
    }
    
    return str;
}

function extractVideosFromFunctionBody(functionBody, paramMap) {
    const videos = [];
    
    // Find the recommend.item array in the function body
    // Pattern: recommend:{item:[{...},{...},...],
    const itemArrayPattern = /recommend:\s*\{\s*item:\s*\[([\s\S]*?)\],\s*business_card:/;
    const itemMatch = functionBody.match(itemArrayPattern);
    
    if (!itemMatch) {
        console.log('Could not find recommend.item array in function body');
        return [];
    }
    
    const itemsString = itemMatch[1];
    console.log('Found items array, length:', itemsString.length);
    
    // Extract individual video object definitions
    const videoObjects = extractObjectDefinitions(itemsString);
    console.log(`Found ${videoObjects.length} video object definitions`);
    
    // Parse each video object
    for (let i = 0; i < videoObjects.length; i++) {
        const objString = videoObjects[i];
        const video = parseVideoObject(objString, paramMap, i);
        
        if (video) {
            // Only include if it has a valid BVID (filter out ads or invalid entries)
            if (video.bvid && typeof video.bvid === 'string' && video.bvid.startsWith('BV')) {
                videos.push(video);
            }
        }
    }
    
    return videos;
}

function extractObjectDefinitions(itemsString) {
    const objects = [];
    let depth = 0;
    let start = -1;
    
    for (let i = 0; i < itemsString.length; i++) {
        if (itemsString[i] === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (itemsString[i] === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
                objects.push(itemsString.substring(start, i + 1));
                start = -1;
            }
        }
    }
    
    return objects;
}

function parseVideoObject(objString, paramMap, index) {
    // Extract field mappings using regex patterns
    // Pattern: fieldName:paramName
    
    const video = {
        _zeeschuimer_metadata: {
            type: 'pinia_embedded_items',
            source: 'html_embedded_obfuscated',
            likely_displayed: true,
            position: index
        }
    };
    
    // Define patterns for fields we care about
    const simpleFields = {
        id: /\bid:(\w+)/,
        bvid: /\bbvid:(\w+)/,
        cid: /\bcid:(\w+)/,
        goto: /\bgoto:(\w+)/,
        uri: /\buri:(\w+)/,
        pic: /\bpic:(\w+)(?!_)/,  // pic but not pic_4_3
        pic_4_3: /\bpic_4_3:(\w+)/,
        title: /\btitle:(\w+)/,
        duration: /\bduration:(\w+)/,
        pubdate: /\bpubdate:(\w+)/,
        av_feature: /\bav_feature:(\w+)/,
        is_followed: /\bis_followed:(\w+)/,
        track_id: /\btrack_id:(\w+)/,
        pos: /\bpos:(\w+)(?!_)/,
    };
    
    // Extract simple fields
    for (const [field, pattern] of Object.entries(simpleFields)) {
        const match = objString.match(pattern);
        if (match) {
            const paramName = match[1];
            const value = paramMap[paramName];
            if (value !== undefined && value !== null) {
                video[field] = value;
            }
        }
    }
    
    // Extract owner object: owner:{mid:X,name:Y,face:Z}
    const ownerPattern = /owner:\s*\{\s*mid:(\w+),\s*name:(\w+),\s*face:(\w+)\s*\}/;
    const ownerMatch = objString.match(ownerPattern);
    if (ownerMatch) {
        video.owner = {
            mid: paramMap[ownerMatch[1]],
            name: paramMap[ownerMatch[2]],
            face: paramMap[ownerMatch[3]]
        };
    }
    
    // Extract stat object: stat:{view:X,like:Y,danmaku:Z,vt:W}
    const statPattern = /stat:\s*\{\s*view:(\w+),\s*like:(\w+),\s*danmaku:(\w+)/;
    const statMatch = objString.match(statPattern);
    if (statMatch) {
        video.stat = {
            view: paramMap[statMatch[1]],
            like: paramMap[statMatch[2]],
            danmaku: paramMap[statMatch[3]]
        };
    }
    
    // Extract rcmd_reason: rcmd_reason:{content:X,reason_type:Y} or rcmd_reason:{reason_type:Y}
    const rcmdPattern = /rcmd_reason:\s*\{([^}]+)\}/;
    const rcmdMatch = objString.match(rcmdPattern);
    if (rcmdMatch) {
        const rcmdContent = rcmdMatch[1];
        const contentMatch = rcmdContent.match(/content:(\w+)/);
        const reasonTypeMatch = rcmdContent.match(/reason_type:(\w+)/);
        
        video.rcmd_reason = {};
        if (contentMatch) {
            video.rcmd_reason.content = paramMap[contentMatch[1]];
        }
        if (reasonTypeMatch) {
            video.rcmd_reason.reason_type = paramMap[reasonTypeMatch[1]];
        }
    }
    
    // Validate - must have at minimum id and bvid
    if (!video.id || !video.bvid) {
        console.log(`Skipping video at position ${index}: missing id or bvid`);
        return null;
    }
    
    console.log(`Parsed video ${index + 1}: ${video.bvid} - "${video.title || 'No title'}"`);
    return video;
}

// Export for both Node.js (testing) and browser (extension) contexts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parsePiniaData };
} else {
    // Browser context - expose globally
    window.parsePiniaData = parsePiniaData;
}
