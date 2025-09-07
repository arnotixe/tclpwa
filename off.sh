#!/bin/bash
# SmartTV Key Sender# Sends TR_KEY_SMARTTV command to TCL TV via netcat
CMD=${1:-"TR_KEY_SMARTTV"}
HOST=${2:-"192.168.100.55"}
PORT=${3:-"4123"}
XML_PAYLOAD='<?xml version="1.0" encoding="utf-8"?><root><action name="setKey" eventAction="TR_DOWN" keyCode="TR_KEY_POWER" /></root>'
echo "Sending $CMD key to $HOST:$PORT"
# strip null byte
res=`echo "$XML_PAYLOAD" | nc "$HOST" "$PORT" -q 0 |tr -d '\0'`
echo "$res"