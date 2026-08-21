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
profile_file = Path(".").joinpath(".temp-profile").resolve()
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

print("Running tests")

if args.login:
    input("Press Enter after you have logged in to the platforms you want to test")

print("")
passed = 0
failed = 0
warnings = 0
start_time = time.time()

hr = "=" * (shutil.get_terminal_size().columns - 5)

for platform, testcases in tests.items():
    start_time = time.time()
    # enable data source in zeeschuimer:
    driver.switch_to.window(handles[0])
    # disable all
    driver.execute_script(
        "document.querySelectorAll('.toggle-switch input').forEach((e) => { if(e.checked) { e.click() }; });")
    # enable current platform
    driver.execute_script("document.querySelectorAll('#zs-enabled-" + platform.replace(".",
                                                                                       "\\\\.") + "').forEach((e) => { if(!e.checked) { e.click(); }}); ")

    print(hr)
    if selected_tests and platform not in selected_tests:
        print(f"{platform} :: skipping")
        continue

    for testcase, urls in testcases.items():
        for url, settings in urls.items():
            print(f"{platform} :: {testcase} :: {url}")

            # reset all data in zeeschuimer
            driver.switch_to.window(handles[0])
            driver.execute_script("document.querySelector('button.reset-all').click();")
            indent = len(platform) * " " + " ::"

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

            # look in Zeeschuimer how many items have been captured
            safename = platform.replace(".", "").replace("-", "")
            driver.switch_to.window(handles[0])
            num_items = int(re.sub("[^0-9]", "", driver.execute_script(
                f"return document.querySelector('#stats-{safename} .num-items').innerText")))

            num_after_scroll = 0
            try_scrolling = settings.get("more-after-scroll", False)
            if try_scrolling:
                # scroll and check if more items are loaded
                driver.switch_to.window(handles[1])
                driver.execute_script("window.scrollBy(0, document.querySelector('html').scrollHeight);")
                time.sleep(0.5)
                driver.execute_script("window.scrollBy(0, document.querySelector('html').scrollHeight);")
                time.sleep(0.5)
                driver.execute_script("window.scrollBy(0, document.querySelector('html').scrollHeight);")
                time.sleep(settings.get("wait", 5) - 1)

                driver.switch_to.window(handles[0])
                num_after_scroll = int(re.sub("[^0-9]", "", driver.execute_script(
                    f"return document.querySelector('#stats-{safename} .num-items').innerText")))

            msg = f"{indent} {str.rjust(str(num_items), 4, ' ')} items :: "
            if try_scrolling:
                msg += f" {str.rjust(str(num_after_scroll), 4, ' ')} after scroll :: "
                if num_items >= expected[0] and num_items <= expected[1] and num_after_scroll > num_items:
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

# done!
driver.close()
driver.quit()
shutil.rmtree(profile_file)
print(hr)
print(f"{sum([passed, failed, warnings]):,} tests completed.")
print(f"Tests took {time.time() - start_time:.2f} seconds")
print("- " + colored(f"[✓] {passed:,}", "green", attrs=["bold"]) + " passed")
print("- " + colored(f"[⋯] {warnings:,}", "yellow", attrs=["bold"]) + " warnings (more items than expected, or unexpected result after scrolling)")
print("- " + colored(f"[⨯] {failed:,}", "red", attrs=["bold"]) + " failures (fewer items than expected)")