async function load() {
    const imported_modules = [
        await import("./tiktok.js"),
        await import("./tiktok-comments.js"),
        await import("./instagram.js"),
        await import("./9gag.js"),
        await import("./imgur.js"),
        await import("./douyin.js"),
        await import("./truth.js"),
        await import("./threads.js"),
        await import("./pinterest.js"),
        await import("./rednote.js"),
        await import("./rednote-comments.js"),
        await import("./linkedin.js"),
        await import("./twitter.js"),
        await import("./gab.js")
    ];

    for(const module of imported_modules) {
        zeeschuimer.register_module(
            module.MODULE_NAME,
            module.DOMAIN,
            module.capture,
            module.MODULE_ID ? module.MODULE_ID : module.MODULE_DOMAIN,
        )
    }
}

load();
