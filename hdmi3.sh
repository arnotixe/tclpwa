# my tv seems to not have an input button :/
delay="1"
sdelay="0.1"
./send.sh TR_KEY_SMARTTV; sleep $delay;
./send.sh TR_KEY_BACK; sleep $delay;
./send.sh TR_KEY_UP; sleep $delay;
./send.sh TR_KEY_UP; sleep $sdelay;
./send.sh TR_KEY_UP; sleep $sdelay;
./send.sh TR_KEY_OK; sleep $delay;
./send.sh TR_KEY_DOWN; sleep $delay;
./send.sh TR_KEY_DOWN; sleep $sdelay;
./send.sh TR_KEY_DOWN; sleep $sdelay;
./send.sh TR_KEY_DOWN; sleep $sdelay;
./send.sh TR_KEY_DOWN; sleep $sdelay;
./send.sh TR_KEY_OK