"use strict";

var MODULES = {
  fs: require('fs'),
  system: require('system'),
  webserver: require("webserver"),
  webpage: require("webpage")
};

// Bring XMLHttpRequest in from the Add-on SDK, do not use the default
// one (which has cross-origin restriction)
var XMLHttpRequest = require('sdk/net/xhr').XMLHttpRequest;

function set_prefs()
{
    var {Cc, Ci} = require("chrome");
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService);
    var root = prefs.getBranch("")
    // This setting is required to use Tor with hidden services;
    // hidden services don't have a real DNS, so we have to give Tor
    // the name.
    root.setBoolPref("network.proxy.socks_remote_dns", true);
    root.setBoolPref("gfx.downloadable_fonts.enabled", false);
    root.setCharPref("dom.popup_allowed_events", "");
    console.log("prefs ok");
}

function finish_work() {
    // Called at the end.
    console.log("bye");
    slimer.exit(0);
}

function is_valid_url(urlstr, site) {
    var u = new URL(urlstr);
    
    
    
    if (site) {
        if (u.hostname.toLowerCase() != site.toLowerCase()) {
            // Wrong site.
            return false;
        }
    }
    
    return (u.protocol == "http:") || 
        (u.protocol == "https:");
}

function fixup_url(urlstr) {
    // Perform any mangling we want to do.
    var hashpos = urlstr.indexOf('#');
    if (hashpos != -1) {
        return urlstr.substr(0, hashpos);
    }
    return urlstr;
}

function SiteCrawler(site) {
    // Constructor for SiteCrawler object.
    this.site = site;
    var page = MODULES.webpage.create();
    this.page = page;
    this.seen_urls = {};
    this.page_id = 0;
    
    this.queue = [ 'http://' + this.site + '/'];
    this.seen_urls[this.queue[0]] = true;
    
    /*
     * Get the site's robots.txt, if it exists.
     */
    this.fetch_robotstxt = function() {
        var crawler = this;
        var robots_txt_url = 'http://' + this.site + '/robots.txt';
        console.log("Fetching " + robots_txt_url);
        // Trigger fetch of robots.txt
        var xhr = new XMLHttpRequest();
        xhr.open("GET", robots_txt_url, true);
        xhr.setRequestHeader("User-Agent", "SlimerXHR");
        xhr.onreadystatechange = function() {
            if (xhr.readyState == 4) {
                console.log("Got robots.txt, or failed");
                console.log("robots.txt status=" + xhr.status);
                console.log("robots.txt statusText=" + xhr.statusText);
                console.log(xhr.responseText);
                crawler.robots_txt = xhr.responseText;
                crawler.process_queue();
            }
        };
        xhr.send(null);
    }
    
    // Fetch next URL in queue.
    this.process_queue = function process_queue() {
        var crawler = this;
        var url = crawler.queue.shift();
        function open_callback(status) {
            console.log("open_callback: status=" + status);
            if (status == "success") {
                // Parse links and add to queue.
                var offsite_links = crawler.handle_links();
                crawler.save_page(url, offsite_links);
            }
            // Get next thing in queue, even if that failed.
            crawler.process_queue();
        }
        if (url) {
            this.page_id += 1;
            console.log("fetching " + url);
            page.open(url,
                open_callback);
        } else {
            console.log("Queue empty");
        }
    };
    
    this.handle_links = function() {
        // Get links out of the page.
        function get_links() {
            function extract_hrefs(elems, links) {
                var i;
                for (i=0; i< elems.length; i++) {
                    var a = elems[i];
                    // Do not extract CSS links
                    var is_css = false;
                    var rel = a.getAttribute('rel');
                    if (rel) {
                        is_css = (rel.toLowerCase() == 'stylesheet');
                    }
                    if (a.href && (! is_css)) {
                        links.push(a.href);
                    }
                }
            }
            var anchors = document.getElementsByTagName('a');
            var link_elems = document.getElementsByTagName('link');
            var links = [];
            extract_hrefs(anchors, links);
            extract_hrefs(link_elems, links);
            return links;
        }
        
        var links = page.evaluate(get_links);
        var offsite_links = [];
        // Remove duplicates, black list etc.
        for (var link of links) {
            link = fixup_url(link);
            if (is_valid_url(link, this.site)) {
                // Check if we've already seen this link?
                if (! (link in this.seen_urls)) {
                    this.queue.push(link);
                    this.seen_urls[link] = true;
                }
            } else {
                if (is_valid_url(link)) {
                    offsite_links.push(link);
                }
                // console.log("bad url:" + link);
            }
        }
        return offsite_links;
    }
    
    this.save_page = function(url, offsite_links) {
        // Make a filename.
        var idstr = this.page_id.toString();
        while (idstr.length < 5) {
            idstr = "0" + idstr;
        }
        var filename = '/dev/shm/sfetch' + idstr;
        var f = MODULES.fs.open(filename, 'w');
        f.write("X-Request-Uri:" + url + "\n");
        f.write("X-Fetched-Uri:" + this.page.url + "\n");
        for (var link of offsite_links) {
            f.write("Offsite-Link:" + link + "\n");
        }
        f.write("\n");
        f.write(page.content);
        f.close();
    }
    
    this.go = function() {
        this.fetch_robotstxt();
    };
}

function main() 
{
    set_prefs();
    var args = MODULES.system.args;
    console.log(JSON.stringify(MODULES.system.args));
    if (args.length < 2) {
        console.log("ERROR: need site name on command-line");
        slimer.exit(1);
        return;
    }
    var site = args[1];
    var crawler = new SiteCrawler(site);
    crawler.go();
    
    window.setTimeout(finish_work, 60000);
}

main();
