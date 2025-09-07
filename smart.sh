#!/bin/bash
# SmartTV Key Sender# Sends TR_KEY_SMARTTV command to TCL TV via netcat
HOST=${1:-"192.168.100.55"}
PORT=${2:-"4123"}
XML_PAYLOAD='<?xml version="1.0" encoding="utf-8"?><root><action name="setKey" eventAction="TR_DOWN" keyCode="TR_KEY_SMARTTV" /></root>'
echo "Sending SmartTV key to $HOST:$PORT"
echo "$XML_PAYLOAD" | nc "$HOST" "$PORT"