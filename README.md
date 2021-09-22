# 🏴‍☠️ Zeeschuimer

<p align="center"><img alt="A screenshot of Zeeschuimer's status window" src="images/example_screenshot.png"></p>

Zeeschuimer is a browser extension that monitors internet traffic while you are browsing a social media site, and 
collects data about the items you see in a platform's web interface for later systematic analysis. Its target audience
is researchers who wish to systematically study content on social media platforms that resist conventional scraping or 
API-based data collection.

You can, for example, browse TikTok and later export a list of all posts you saw in the order you saw them in. Data can 
be exported as a JSON file or exported to a [4CAT](https://github.com/digitalmethodsinitiative/4cat) instance for 
analysis and storage.

Currently, it supports the following platforms:
* TikTok via https://www.tiktok.com
* Instagram via https://www.instagram.com

Platform support requires regular maintenance to keep up with changes to the platforms. If something does not work, we
welcome issues and pull requests.

The extension does not interfere with your normal browsing and never uploads data automatically, only when you 
explicitly ask it to do so.

## Installation
Zeeschuimer is in active development. .xpi files of work-in-progress versions are available on the 
[releases](https://github.com/digitalmethodsinitiative/zeeschuimer/releases) page. These are signed and can be installed 
in any Firefox-based browser. If you want to run the latest development version instead, you can [do so from the Firefox
debugging console](https://www.youtube.com/watch?v=sAM78GU4P34&feature=emb_title).

## Credits & license
Zeeschuimer was developed by Stijn Peeters for the [Digital Methods Initiative](https://digitalmethods.net) and is 
licensed under the Mozilla Public License, 2.0. Refer to the LICENSE file for more information.

Skull icon based on '[Smile Skull Vector Icons](https://www.vecteezy.com/vector-art/93157-smile-skull-vector-icons)' by 
lavarmsg on Vecteezy.

Development is supported by the Dutch [PDI-SSH](https://pdi-ssh.nl/en/) foundation through the [CAT4SMR 
project](https://cat4smr.humanities.uva.nl/).
