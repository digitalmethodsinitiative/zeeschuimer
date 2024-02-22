"""
Tests for Zeeschuimer

See README.md
"""
import argparse
import shutil
import json
import time
import os

from selenium.webdriver.firefox.options import Options
from termcolor import colored
from selenium import webdriver
from datetime import datetime
from platform import system
from os.path import expanduser
from pathlib import Path
from glob import glob

cli = argparse.ArgumentParser()
cli.add_argument("--profiledir", help="Firefox profile folder", default="")
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
shutil.copytree(profile_dir, profile_file, ignore=lambda x, y: ["storage", "extensions"])

# set up selenium with zeeschuimer loaded
print("Launching Firefox")
options = Options()
profile = webdriver.FirefoxProfile(str(profile_file))
profile.set_preference("security.fileuri.strict_origin_policy", False)
profile.update_preferences()

options.profile = profile
driver = webdriver.Firefox(options=options)

# load zeeschuimer from parent folder
driver.install_addon(str(Path("..").resolve()), temporary=True)

# make it a bit more difficult to detec that we're using selenium
driver.execute_script(open("stealth.js").read())

# these are kind of arbitrary, but seem to work
driver.set_page_load_timeout(15)
driver.set_script_timeout(120)
driver.implicitly_wait(5)

# find UUID to get Zeeschuimer interface URL
# we cannot directly interact with the extension, but we can find the UUID
# (which is randomized because we're loading the extension as a folder, not an
# xpi file) via the 'temporary addons' panel in the Firefox debugging settings
# we need the UUID to find the URL of the Zeeschuimer interface to manipulate
driver.get("about:debugging")
time.sleep(0.1)
driver.execute_script("document.querySelector('.sidebar-item__link[href*=runtime]').click();")
time.sleep(0.1)
uuid = driver.execute_script("return document.querySelector('a[href*=manifest]').getAttribute('href').split('/')[2];");
zeeschuimer_url = f"moz-extension://{uuid}/popup/interface.html"

# open interface in first tab and open another one for the platform sites
driver.get(zeeschuimer_url)
driver.switch_to.new_window("tab")
handles = driver.window_handles

print("Running tests")
with open("tests.json") as infile:
    tests = json.load(infile)

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
    for testcase, urls in testcases.items():
        for url, settings in urls.items():
            print(f"{platform} :: {testcase} :: {url}")

            # reset all data in zeeschuimer
            driver.switch_to.window(handles[0])
            driver.execute_script("document.querySelector('button.reset-all').click();")
            indent = len(platform) * " " + " ::"

            # load relevant platform page in other tab
            driver.switch_to.window(handles[1])
            driver.get(url)
            time.sleep(settings.get("wait", 5))

            # look in Zeeschuimer how many items have been captured
            driver.switch_to.window(handles[0])
            safename = platform.replace(".", "")
            num_items = driver.execute_script(
                f"return document.querySelector('#stats-{safename} .num-items').innerText")
            num_items = int(num_items.replace(",", "").replace(".", ""))

            msg = f"{indent} {str.rjust(str(num_items), 4, ' ')} items :: "
            if num_items == settings["expected"]:
                msg += colored("[✓]", "green", attrs=["bold"]) + " as expected"
                passed += 1
            elif num_items > settings["expected"]:
                msg += colored("[⋯]", "yellow", attrs=["bold"]) + f" expected {settings['expected']:,}, but got more"
                warnings += 1
            else:
                msg += colored("[⨯]", "red", attrs=["bold"]) + f" expected {settings['expected']:,}, but got fewer"
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
print("- " + colored(f"[⋯] {warnings:,}", "yellow", attrs=["bold"]) + " warnings (more items than expected)")
print("- " + colored(f"[⨯] {failed:,}", "red", attrs=["bold"]) + " failures (fewer items than expected)")