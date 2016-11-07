exec slimerjs --debug=no \
    --proxy=localhost:9050 \
    --proxy-type=socks5 \
    slimerfetch.js $*
