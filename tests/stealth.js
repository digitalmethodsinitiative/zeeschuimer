window.chrome = {
    runtime: {}
}
window.console.debug = () => {
    return null
}
Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
    });
(() => {
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.__proto__.query = parameters =>
        parameters.name === 'notifications'
            ? Promise.resolve({state: Notification.permission})
            : originalQuery(parameters)
    const oldCall = Function.prototype.call

    function call() {
        return oldCall.apply(this, arguments)
    }

    Function.prototype.call = call
    const nativeToStringFunctionString = Error.toString().replace(
        /Error/g,
        'toString'
    )
    const oldToString = Function.prototype.toString

    function functionToString() {
        if (this === window.navigator.permissions.query) {
            return 'function query() { [native code] }'
        }
        if (this === functionToString) {
            return nativeToStringFunctionString
        }
        return oldCall.call(oldToString, this)
    }

    Function.prototype.toString = functionToString
})();
(() => {
    function mockPluginsAndMimeTypes() {
        const makeFnsNative = (fns = []) => {
            const oldCall = Function.prototype.call

            function call() {
                return oldCall.apply(this, arguments)
            }

            Function.prototype.call = call
            const nativeToStringFunctionString = Error.toString().replace(
                /Error/g,
                'toString'
            )
            const oldToString = Function.prototype.toString

            function functionToString() {
                for (const fn of fns) {
                    if (this === fn.ref) {
                        return `function ${fn.name}() { [native code] }`
                    }
                }
                if (this === functionToString) {
                    return nativeToStringFunctionString
                }
                return oldCall.call(oldToString, this)
            }

            Function.prototype.toString = functionToString
        }
        const mockedFns = []
        const fakeData = {
            mimeTypes: [
                {
                    type: 'application/pdf',
                    suffixes: 'pdf',
                    description: '',
                    __pluginName: 'Chrome PDF Viewer'
                },
                {
                    type: 'application/x-google-chrome-pdf',
                    suffixes: 'pdf',
                    description: 'Portable Document Format',
                    __pluginName: 'Chrome PDF Plugin'
                },
                {
                    type: 'application/x-nacl',
                    suffixes: '',
                    description: 'Native Client Executable',
                    enabledPlugin: Plugin,
                    __pluginName: 'Native Client'
                },
                {
                    type: 'application/x-pnacl',
                    suffixes: '',
                    description: 'Portable Native Client Executable',
                    __pluginName: 'Native Client'
                }
            ],
            plugins: [
                {
                    name: 'Chrome PDF Plugin',
                    filename: 'internal-pdf-viewer',
                    description: 'Portable Document Format'
                },
                {
                    name: 'Chrome PDF Viewer',
                    filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                    description: ''
                },
                {
                    name: 'Native Client',
                    filename: 'internal-nacl-plugin',
                    description: ''
                }
            ],
            fns: {
                namedItem: instanceName => {
                    const fn = function (name) {
                        if (!arguments.length) {
                            throw new TypeError(
                                `Failed to execute 'namedItem' on '${instanceName}': 1 argument required, but only 0 present.`
                            )
                        }
                        return this[name] || null
                    }
                    mockedFns.push({ref: fn, name: 'namedItem'})
                    return fn
                },
                item: instanceName => {
                    const fn = function (index) {
                        if (!arguments.length) {
                            throw new TypeError(
                                `Failed to execute 'namedItem' on '${instanceName}': 1 argument required, but only 0 present.`
                            )
                        }
                        return this[index] || null
                    }
                    mockedFns.push({ref: fn, name: 'item'})
                    return fn
                },
                refresh: instanceName => {
                    const fn = function () {
                        return undefined
                    }
                    mockedFns.push({ref: fn, name: 'refresh'})
                    return fn
                }
            }
        }
        const getSubset = (keys, obj) =>
            keys.reduce((a, c) => ({...a, [c]: obj[c]}), {})

        function generateMimeTypeArray() {
            const arr = fakeData.mimeTypes
                .map(obj => getSubset(['type', 'suffixes', 'description'], obj))
                .map(obj => Object.setPrototypeOf(obj, MimeType.prototype))
            arr.forEach(obj => {
                arr[obj.type] = obj
            })
            arr.namedItem = fakeData.fns.namedItem('MimeTypeArray')
            arr.item = fakeData.fns.item('MimeTypeArray')
            return Object.setPrototypeOf(arr, MimeTypeArray.prototype)
        }

        const mimeTypeArray = generateMimeTypeArray()
        Object.defineProperty(navigator, 'mimeTypes', {
            get: () => mimeTypeArray
        })

        function generatePluginArray() {
            const arr = fakeData.plugins
                .map(obj => getSubset(['name', 'filename', 'description'], obj))
                .map(obj => {
                    const mimes = fakeData.mimeTypes.filter(
                        m => m.__pluginName === obj.name
                    )
                    mimes.forEach((mime, index) => {
                        navigator.mimeTypes[mime.type].enabledPlugin = obj
                        obj[mime.type] = navigator.mimeTypes[mime.type]
                        obj[index] = navigator.mimeTypes[mime.type]
                    })
                    obj.length = mimes.length
                    return obj
                })
                .map(obj => {
                    obj.namedItem = fakeData.fns.namedItem('Plugin')
                    obj.item = fakeData.fns.item('Plugin')
                    return obj
                })
                .map(obj => Object.setPrototypeOf(obj, Plugin.prototype))
            arr.forEach(obj => {
                arr[obj.name] = obj
            })
            arr.namedItem = fakeData.fns.namedItem('PluginArray')
            arr.item = fakeData.fns.item('PluginArray')
            arr.refresh = fakeData.fns.refresh('PluginArray')
            return Object.setPrototypeOf(arr, PluginArray.prototype)
        }

        const pluginArray = generatePluginArray()
        Object.defineProperty(navigator, 'plugins', {
            get: () => pluginArray
        })
        makeFnsNative(mockedFns)
    }

    try {
        const isPluginArray = navigator.plugins instanceof PluginArray
        const hasPlugins = isPluginArray && navigator.plugins.length > 0
        if (isPluginArray && hasPlugins) {
            return
        }
        mockPluginsAndMimeTypes()
    } catch (err) {
    }
})();
(() => {
    const newProto = navigator.__proto__
    delete newProto.webdriver
    navigator.__proto__ = newProto
})();
(() => {
    try {
        const getParameter = WebGLRenderingContext.getParameter
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
            if (parameter === 37445) {
                return 'Intel Inc.'
            }
            if (parameter === 37446) {
                return 'Intel Iris OpenGL Engine'
            }
            return getParameter(parameter)
        }
    } catch (err) {
    }
})();
(() => {
    try {
        if (window.outerWidth && window.outerHeight) {
            return
        }
        const windowFrame = 85
        window.outerWidth = window.innerWidth
        window.outerHeight = window.innerHeight + windowFrame
    } catch (err) {
    }
})();