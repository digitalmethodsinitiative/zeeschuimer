"""
Tests for Zeeschuimer

See README.md
"""
import argparse
import shutil
import json
import time
import os
import re
import sys
import tempfile
import uuid

# Result lines are marked with ✓ / ⋯ / ⨯. On Windows, stdout falls back to
# cp1252 whenever it is not a console
try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    # stdout replaced by a stream that does not support reconfigure
    pass

from addon_package import package_addon
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.common import exceptions as selenium_exceptions
from termcolor import colored
from selenium import webdriver
from datetime import datetime
from platform import system
from os.path import expanduser
from pathlib import Path
from glob import glob

cli = argparse.ArgumentParser()
cli.add_argument("--profiledir", help="Firefox profile folder", default="")
cli.add_argument("--geckodriver", help="Path to geckodriver", default="")
cli.add_argument("--binary", help="Path to the Firefox binary. Only needed when geckodriver cannot "
                                  "find Firefox itself, which happens with portable builds and some "
                                  "non-default installs.", default="")
cli.add_argument("--login", help="Wait and allow user to login", default=False, action="store_true")
cli.add_argument("--tests", help="Path to JSON file containing tests", default="tests.json")
cli.add_argument("--sources", help="Sources to test, comma-separated; by default, test all", default="")
cli.add_argument("--fourcat", help="Base URL of a 4CAT server, e.g. http://localhost. Each platform's "
                                   "captured items are uploaded to it once that platform's tests finish, "
                                   "so that 4CAT is made to read every format the run captured. Requires "
                                   "being logged in to that server in the test browser.", default="")
cli.add_argument("--dump-dir", help="Folder to write each platform's captured items to as NDJSON. Byte for "
                                    "byte what an upload would send, so a dump can be uploaded by hand "
                                    "later.", default="")
cli.add_argument("--keep-open", help="Leave the browser running after the tests finish, to look at what was "
                                     "captured. The temporary profile is kept too.",
                 default=False, action="store_true")
args = cli.parse_args()

# find profile
# logging in to instagram, tiktok etc is complicated
# work around this by re-using a firefox profile in which these sites are
# already logged into (ideally, the tester's own profile)
profile_glob = {
    "Windows": "~/AppData/Roaming/Mozilla/Firefox/Profiles/*",
    "Darwin": "~/Library/Application Support/Firefox/Profiles/*",
}.get(system(), "~/.mozilla/firefox/*")

if args.profiledir:
    if not Path(args.profiledir).exists():
        print(f"Profile folder {args.profiledir} not found.")
        exit(1)

    profile_dir = args.profiledir

else:
    profiles = glob(expanduser(profile_glob))
    if len(profiles) == 0:
        print("No profile found. Pass one explicitly with --profiledir.")
        exit(1)

    if len(profiles) > 1:
        print("Multiple profiles found:")
        profiles = sorted(profiles, key=lambda d: os.stat(d).st_mtime, reverse=True)
        for profile in profiles:
            mtime = datetime.fromtimestamp(os.stat(profile).st_mtime)
            print(f"- ({mtime.strftime('%Y-%m-%d %H:%M:%S')}) {profile}")

        print("Choosing most recently used one (first in the list above)")
    else:
        print(f"Using profile {profiles[0]}")

    profile_dir = profiles[0]
    print("Use --profiledir to explicitly choose another directory to use\n")
    print("Copying profile to a temporary location...")

# copy important bits of profile to a temporary folder (so we don't mess with
# the original)
# .absolute() rather than .resolve(): before Python 3.10, resolve() on Windows
# hands back the relative path unchanged when the target does not exist yet,
# which is every first run.
profile_file = Path(".temp-profile").absolute()
if profile_file.exists():
    shutil.rmtree(profile_file)

# do not copy cache and extensions since these can mess things up and can be
# extremely large
# also do not copy signedInUser.json to not sync any changes we make to the
# profile
shutil.copytree(profile_dir, profile_file, ignore=lambda x, y: ["storage", "extensions", "signedInUser.json"])

with open(args.tests) as infile:
    tests = json.load(infile)

selected_tests = [f for f in args.sources.split(",") if f.strip()]
print("Tests found for platforms: {}".format(", ".join(tests.keys())))
if selected_tests:
    print(f"Tests to run: {', '.join(selected_tests)}")
else:
    print("Running all tests.")

# set up selenium with zeeschuimer loaded
print("Launching Firefox")
options = Options()
profile = webdriver.FirefoxProfile(str(profile_file))
profile.set_preference("security.fileuri.strict_origin_policy", False)
zeeschuimer_uuid = str(uuid.uuid4())
profile.set_preference(
    "extensions.webextensions.uuids",
    json.dumps({"zeeschuimer@digitalmethods.net": zeeschuimer_uuid}),
)
dump_dir = Path(args.dump_dir).resolve() if args.dump_dir else None
if dump_dir:
    dump_dir.mkdir(parents=True, exist_ok=True)
    # Exports are triggered from the extension, so Firefox must save them
    # without asking and without opening the downloads panel over the page.
    profile.set_preference("browser.download.folderList", 2)
    profile.set_preference("browser.download.dir", str(dump_dir))
    profile.set_preference("browser.download.useDownloadDir", True)
    profile.set_preference("browser.download.alwaysOpenPanel", False)
    profile.set_preference("browser.helperApps.neverAsk.saveToDisk",
                           "application/x-ndjson,application/json,text/plain,application/octet-stream")

profile.update_preferences()

options.profile = profile

# geckodriver normally locates Firefox by itself, but it cannot always do so -
# portable builds and some installs leave it unable to find a binary at all.
# Prefer an explicit --binary, otherwise fall back to the platform's usual
# install path if something is actually there.
firefox_binary = args.binary
if not firefox_binary:
    default_binaries = {
        "Windows": [
            "C:/Program Files/Mozilla Firefox/firefox.exe",
            "C:/Program Files (x86)/Mozilla Firefox/firefox.exe",
        ],
        "Darwin": ["/Applications/Firefox.app/Contents/MacOS/firefox"],
    }.get(system(), ["/usr/bin/firefox", "/usr/local/bin/firefox", "/snap/bin/firefox"])
    firefox_binary = next((path for path in default_binaries if Path(path).exists()), "")

if firefox_binary:
    print(f"Using Firefox binary {firefox_binary}")
    options.binary_location = firefox_binary

service = Service(
    executable_path=args.geckodriver or None,
    service_args=["--allow-system-access"],
)
driver = webdriver.Firefox(service=service, options=options)

# Load Zeeschuimer without development-only directories such as node_modules.
with tempfile.TemporaryDirectory() as temporary_directory:
    addon_path = Path(temporary_directory, "zeeschuimer.xpi")
    package_addon(Path("..").resolve(), addon_path)
    driver.install_addon(str(addon_path), temporary=True)

# make it a bit more difficult to detec that we're using selenium
driver.execute_script(open("stealth.js").read())

# these are kind of arbitrary, but seem to work
driver.set_page_load_timeout(15)
driver.set_script_timeout(120)
driver.implicitly_wait(5)

# The test profile maps Zeeschuimer's manifest ID to this UUID before Firefox
# starts. Marionette blocks direct navigation to moz-extension URLs, so Firefox
# browser chrome performs the trusted navigation instead.
print("Ensuring Zeeschuimer is loaded")
zeeschuimer_url = f"moz-extension://{zeeschuimer_uuid}/popup/interface.html"
with driver.context(driver.CONTEXT_CHROME):
    driver.execute_script(
        """
        const { BrowserWindowTracker } = ChromeUtils.importESModule(
            "resource:///modules/BrowserWindowTracker.sys.mjs"
        );
        const browser_window = BrowserWindowTracker.getTopWindow();
        browser_window.gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        """,
        zeeschuimer_url,
    )
WebDriverWait(driver, 10).until(
    lambda current_driver: (
        current_driver.current_url == zeeschuimer_url
        and current_driver.find_element(By.CSS_SELECTOR, "button.reset-all")
    )
)

# open interface in first tab and open another one for the platform sites
driver.switch_to.new_window("tab")
handles = driver.window_handles

# Cases no longer run against an empty database, so an item that appears on
# more than one page of a platform has to be recorded each time for the
# per-case counts below to mean anything. That is what "Keep duplicates" does;
# a borrowed profile set to anything else would silently under-count. Drive the
# interface's own control rather than writing to storage directly, so the
# setting takes effect the same way it does for a user.
driver.switch_to.window(handles[0])
driver.execute_script("""
const select = document.querySelector('#duplicate-behavior');
if (select && select.value !== 'insert') {
    select.value = 'insert';
    select.dispatchEvent(new Event('change', {bubbles: true}));
}
""")

# An unset key means the background script's own default, which is 'insert'.
duplicate_behavior = driver.execute_async_script("""
const done = arguments[arguments.length - 1];
browser.storage.local.get('zs-duplicate-behavior')
    .then(values => done(values['zs-duplicate-behavior'] || 'insert'));
""")
if duplicate_behavior != "insert":
    print(f"{colored('[⨯]', 'red', attrs=['bold'])} duplicate handling is set to '{duplicate_behavior}' and "
          f"could not be changed to 'insert'. Items seen on more than one page of a platform would be "
          f"dropped, making every count below too low.")
    driver.close()
    driver.quit()
    shutil.rmtree(profile_file)
    exit(1)

print("Running tests")

if args.login:
    input("Press Enter after you have logged in to the platforms you want to test")

# Check the 4CAT session before any tests run: finding out about an expired
# login after a platform's worth of browsing is a waste of everyone's time.
def ask(fallback=""):
    """Read a keypress-ish answer, falling back when there is no terminal.

    These tests are supervised, but they are also run from CI and from wrapper
    scripts where stdin is closed. Prompting there raises EOFError mid-run and
    loses everything captured so far, so an unattended run takes the fallback
    and carries on instead.
    """
    try:
        return input().strip().lower()
    except EOFError:
        print(f"  (nothing on stdin; continuing as if \"{fallback}\")")
        return fallback


uploads_enabled = bool(args.fourcat)
uploaded_datasets = []
if args.fourcat:
    print(f"Checking 4CAT at {args.fourcat}")
    driver.switch_to.window(handles[1])
    try:
        driver.get(args.fourcat)
    except selenium_exceptions.TimeoutException:
        print(f"  {colored('[⨯]', 'red', attrs=['bold'])} took too long to load")
    if "/login/" in driver.current_url:
        print("  not logged in. Log in in the browser window, then press Enter "
              "-- or [n] to run without uploading.")
        if ask(fallback="n") == "n":
            uploads_enabled = False
        else:
            driver.get(args.fourcat)
            if "/login/" in driver.current_url:
                print(f"  {colored('[⨯]', 'red', attrs=['bold'])} still not logged in; "
                      f"uploads are off for this run")
                uploads_enabled = False
    if uploads_enabled:
        print("  logged in")

print("")
passed = 0
failed = 0
warnings = 0
start_time = time.time()

# Not every feed scrolls the document. Douyin keeps the page itself at exactly
# viewport height and scrolls an inner container instead, so window.scrollBy
# moves nothing there and every test for it reports no increase after scrolling.
# Scroll the document where the document is what scrolls, and otherwise the
# largest scrollable element on the page. Returns whether the scroll position
# actually changed, so a feed that loaded nothing more can be told apart from a
# scroll that never happened.
scroll_script = """
if (document.documentElement.scrollHeight > window.innerHeight + 50) {
    const before = window.scrollY;
    window.scrollBy(0, document.querySelector('html').scrollHeight);
    return window.scrollY !== before;
}

let target = null;
for (const element of document.querySelectorAll("div, main, section, ul")) {
    if (element.clientHeight < 200) continue;
    if (element.scrollHeight <= element.clientHeight + 100) continue;
    if (!/(auto|scroll)/.test(getComputedStyle(element).overflowY)) continue;
    const area = element.clientHeight * element.clientWidth;
    if (!target || area > target.clientHeight * target.clientWidth) target = element;
}
if (!target) return false;

const before = target.scrollTop;
target.scrollTop = target.scrollHeight;
return target.scrollTop !== before;
"""

def captured_so_far(platform):
    """How many items Zeeschuimer holds for a platform, read from its interface."""
    safename = platform.replace(".", "").replace("-", "")
    driver.switch_to.window(handles[0])
    return int(re.sub("[^0-9]", "", driver.execute_script(
        f"return document.querySelector('#stats-{safename} .num-items').innerText")))



def platform_indent(platform):
    return len(platform) * " " + " ::"


def export_platform(platform):
    """Save a platform's captured items via the interface's own NDJSON download."""
    indent = platform_indent(platform)
    already_there = set(dump_dir.glob("zeeschuimer-export-*.ndjson"))

    driver.switch_to.window(handles[0])
    clicked = driver.execute_script("""
        const button = document.querySelector(
            '.download-format[data-platform="' + arguments[0] + '"][data-format="ndjson"]');
        if (!button) { return false; }
        button.click();
        return true;
    """, platform)
    if not clicked:
        print(f"{indent} {colored('[⨯]', 'red', attrs=['bold'])} no NDJSON download offered for this platform")
        return None

    # A download in flight leaves a .part file next to its target.
    deadline = time.time() + 120
    while time.time() < deadline:
        arrived = set(dump_dir.glob("zeeschuimer-export-*.ndjson")) - already_there
        if arrived and not list(dump_dir.glob("*.part")):
            export = arrived.pop()
            print(f"{indent} exported {export.name} ({export.stat().st_size:,} bytes)")
            return export
        time.sleep(0.5)

    print(f"{indent} {colored('[⨯]', 'red', attrs=['bold'])} export did not finish in time")
    return None


# What the interface writes into #upload-status when an upload does not work.
# Order matters: the generic "during upload" wording also appears inside the
# more specific messages.
UPLOAD_FAILURES = [
    ("not logged in", "You are not logged in to this 4CAT server"),
    ("not logged in", "Could not log in to 4CAT server"),
    ("refused, too soon after the previous upload", "too soon after previous one"),
    ("platform not accepted by this 4CAT", "does not accept"),
    ("could not connect", "Could not connect to 4CAT server"),
    ("malformed response", "malformed response from 4CAT server"),
    ("upload error", "during upload"),
]


def upload_platform(platform):
    """
    Upload whatever Zeeschuimer currently holds for a platform.

    Drives the same button a user would, so the request carries the extension's
    own headers and session. Returns the dataset URL, or ("error", label, text).
    """
    driver.switch_to.window(handles[0])
    driver.execute_script("""
        const field = document.querySelector('#fourcat-url');
        if (field && field.value !== arguments[0]) {
            field.value = arguments[0];
            field.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
        }
    """, args.fourcat)

    # The button is enabled by the stats poller once a URL is stored, so it is
    # briefly still disabled after the field is filled in.
    button = '.upload-to-4cat[data-platform="' + platform + '"]'
    try:
        WebDriverWait(driver, 15).until(lambda current_driver: current_driver.execute_script(
            "const b = document.querySelector(arguments[0]); return !!b && !b.hasAttribute('disabled');",
            button))
    except selenium_exceptions.TimeoutException:
        return ("error", "upload button never became available",
                "Zeeschuimer may hold no items for this platform")

    driver.execute_script("document.querySelector(arguments[0]).click();", button)

    deadline = time.time() + 600
    while time.time() < deadline:
        state = driver.execute_script("""
            const status = document.getElementById('upload-status');
            const link = status ? status.querySelector('a[href]') : null;
            return {text: status ? status.innerText : '', url: link ? link.href : null};
        """)
        if state["url"]:
            return state["url"]
        for label, needle in UPLOAD_FAILURES:
            if needle in state["text"]:
                return ("error", label, " ".join(state["text"].split()))
        time.sleep(1)

    return ("error", "timed out", "4CAT did not finish processing within 600 seconds")


def upload_platform_supervised(platform):
    """
    Upload, and let the tester deal with anything they can fix.

    Sessions expire and 4CAT rate-limits consecutive uploads; both are cleared
    by a human rather than by retrying harder. Returns the dataset URL, or None
    if this platform was skipped.
    """
    global uploads_enabled
    indent = platform_indent(platform)

    while True:
        outcome = upload_platform(platform)
        if not isinstance(outcome, tuple):
            print(f"{indent} uploaded to {outcome}")
            return outcome

        _, label, message = outcome
        print(f"{indent} {colored('[!]', 'yellow', attrs=['bold'])} 4CAT upload failed: {label}")
        print(f"{indent}     {message}")

        # 4CAT not having the data source enabled is not something the tester
        # can clear from the browser, and it is the most interesting thing this
        # whole step can report, so let it stand rather than prompting.
        if label == "platform not accepted by this 4CAT":
            return None

        print(f"{indent}     [Enter] retry   [s] skip this platform   [n] stop uploading")
        choice = ask(fallback="n")
        if choice == "s":
            return None
        if choice == "n":
            uploads_enabled = False
            return None


hr = "=" * (shutil.get_terminal_size().columns - 5)

try:
    for platform, testcases in tests.items():
        if selected_tests and platform not in selected_tests:
            print(hr)
            print(f"{platform} :: skipping")
            continue

        start_time = time.time()
        # enable data source in zeeschuimer:
        driver.switch_to.window(handles[0])

        # wait for the actual buttons to be present in the Zeeschuimer interface
        toggle_selector = "#zs-enabled-" + platform.replace(".", "\\.")
        try:
            WebDriverWait(driver, 15).until(
                lambda current_driver: current_driver.execute_script(
                    "return !!document.querySelector(arguments[0]);", toggle_selector))
        except selenium_exceptions.TimeoutException:
            print(hr)
            print(f"{platform} :: {colored('[⨯]', 'red', attrs=['bold'])} no toggle found in the Zeeschuimer "
                  f"interface ({toggle_selector}); is the module registered under this id? Skipping.")
            continue

        # disable all
        driver.execute_script(
            "document.querySelectorAll('.toggle-switch input').forEach((e) => { if(e.checked) { e.click() }; });")
        # enable current platform
        driver.execute_script(
            "document.querySelectorAll(arguments[0]).forEach((e) => { if(!e.checked) { e.click(); }});",
            toggle_selector)

        # Confirm capture is actually on. Without this the tests below would run
        # against a disabled module and report zeroes that mean nothing.
        if not driver.execute_script("return !!document.querySelector(arguments[0])?.checked;", toggle_selector):
            print(hr)
            print(f"{platform} :: {colored('[⨯]', 'red', attrs=['bold'])} could not enable capture in "
                  f"Zeeschuimer; skipping (results would be meaningless)")
            continue

        print(hr)

        # One dataset per platform: clear here rather than between cases, so that
        # everything a platform captured can be exported or uploaded in one go.
        driver.execute_script("document.querySelector('button.reset-all').click();")

        for testcase, urls in testcases.items():
            for url, settings in urls.items():
                print(f"{platform} :: {testcase} :: {url}")
                indent = len(platform) * " " + " ::"

                items_before = captured_so_far(platform)

                # load relevant platform page in other tab
                driver.switch_to.window(handles[1])
                try:
                    driver.get(url)
                    time.sleep(settings.get("wait", 5))
                except selenium_exceptions.TimeoutException:
                    # Page may contain data already, but note timeout
                    print(f"{indent} {colored('[⨯]', 'yellow', attrs=['bold'])} page took longer than timeout to load")

                # Check for captcha
                if settings.get("captcha-selector", False):
                    # NOTE: captcha detection may require longer wait times as they do not display immediately
                    try:
                        captcha_element = driver.find_element(By.CSS_SELECTOR, settings.get("captcha-selector"))
                        if captcha_element.is_displayed():
                            print(colored(f"{indent} :: [⚠️] Captcha detected... Press Enter after you have solved the captcha", "yellow"))
                            input()
                    except selenium_exceptions.NoSuchElementException:
                        pass

                # ranges are expressed as tuples/lists (inclusive)
                # if it's not a range, make it one anyway
                expected = [settings["expected"], settings["expected"]] if type(settings["expected"]) is not list else settings["expected"]
                nice_expected = f"between {expected[0]:,} and {expected[1]:,}" if expected[0] != expected[1] else str(expected[0])

                # what this page added, rather than what the database holds
                num_items = captured_so_far(platform) - items_before

                num_after_scroll = 0
                scrolled = False
                try_scrolling = settings.get("more-after-scroll", False)
                if try_scrolling:
                    # scroll and check if more items are loaded
                    driver.switch_to.window(handles[1])
                    for pause in (0.5, 0.5, settings.get("wait", 5) - 1):
                        scrolled = driver.execute_script(scroll_script) or scrolled
                        time.sleep(pause)

                    num_after_scroll = captured_so_far(platform) - items_before

                msg = f"{indent} {str.rjust(str(num_items), 4, ' ')} items :: "
                if try_scrolling:
                    msg += f" {str.rjust(str(num_after_scroll), 4, ' ')} after scroll :: "
                    if not scrolled and num_after_scroll == num_items:
                        msg += colored("[⋯]", "yellow", attrs=["bold"]) + f" nothing on the page scrolled, so scrolling was not tested"
                        warnings += 1
                    elif num_items >= expected[0] and num_items <= expected[1] and num_after_scroll > num_items:
                        msg += colored("[✓]", "green", attrs=["bold"]) + " as expected"
                        passed += 1
                    elif expected[0] > num_items and num_after_scroll > num_items:
                        msg += colored("[⋯]", "yellow", attrs=["bold"]) + f" expected {nice_expected}, get fewer, but more after scrolling"
                        warnings += 1
                    elif num_items > expected[1] and num_after_scroll > num_items:
                        msg += colored("[⋯]", "yellow", attrs=["bold"]) + f" expected {nice_expected}, get more, but more after scrolling"
                        warnings += 1
                    elif num_items >= expected[0] and num_items <= expected[1] and num_after_scroll == num_items:
                        msg += colored("[⋯]", "yellow", attrs=["bold"]) + f" as expected, but no increase after scrolling"
                        warnings += 1
                    else:
                        msg += colored("[⨯]", "red", attrs=["bold"]) + f" expected more after scroll, but no increase"
                        failed += 1
                else:
                    msg += f"      no scrolling :: "
                    if num_items >= expected[0] and num_items <= expected[1]:
                        msg += colored("[✓]", "green", attrs=["bold"]) + " as expected"
                        passed += 1
                    elif num_items > expected[1]:
                        msg += colored("[⋯]", "yellow", attrs=["bold"]) + f" expected {nice_expected}, but got more"
                        warnings += 1
                    else:
                        msg += colored("[⨯]", "red", attrs=["bold"]) + f" expected {nice_expected}, but got fewer"
                        failed += 1

                print(msg)

        # Everything this platform captured, as one dataset. Uploading a run that
        # went badly is the point rather than a mistake: a capture 4CAT cannot read
        # is exactly what this is meant to surface.
        captured = captured_so_far(platform)
        if not captured:
            if dump_dir or uploads_enabled:
                print(f"{platform_indent(platform)} nothing captured, so nothing to export or upload")
        else:
            if dump_dir:
                export_platform(platform)
            if uploads_enabled:
                dataset_url = upload_platform_supervised(platform)
                if dataset_url:
                    uploaded_datasets.append((platform, captured, dataset_url))

except KeyboardInterrupt:
    print("")
    print(hr)
    print("Interrupted. Reporting what ran before that.")
finally:
    # Without this a run that times out or is interrupted leaves a browser
    # and a copied profile behind.
    if args.keep_open:
        # geckodriver takes the browser down with it when this process ends, so
        # keeping the window usable means not ending yet.
        print(hr)
        print(f"Browser left open with everything this run captured. Its profile is at {profile_file}")
        try:
            input("Press Enter to close it and delete the profile.")
        except EOFError:
            # nothing on stdin to wait for; close as usual
            pass
    try:
        driver.quit()
    except Exception as error:
        print(f"Browser did not shut down cleanly: {error}")
    shutil.rmtree(profile_file, ignore_errors=True)

print(hr)
print(f"{sum([passed, failed, warnings]):,} tests completed.")
print(f"Tests took {time.time() - start_time:.2f} seconds")
print("- " + colored(f"[✓] {passed:,}", "green", attrs=["bold"]) + " passed")
print("- " + colored(f"[⋯] {warnings:,}", "yellow", attrs=["bold"]) + " warnings (more items than expected, or unexpected result after scrolling)")
print("- " + colored(f"[⨯] {failed:,}", "red", attrs=["bold"]) + " failures (fewer items than expected)")

if uploaded_datasets:
    print("")
    print("4CAT datasets")
    for uploaded_platform, item_count, dataset_url in uploaded_datasets:
        print(f"  {uploaded_platform:<16} {dataset_url:<50} {item_count:,} items")
    keys = [dataset_url.rstrip("/").split("/")[-1] for _, _, dataset_url in uploaded_datasets]
    print("")
    print(f"FOURCAT_DATASETS={','.join(keys)}")