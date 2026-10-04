# go to Chicago PD directly

```bash
SERVERURL="http://localhost:9510"
UREMOTEID=$(curl -s "$SERVERURL/client/connect" | jq -r '.id')
SRC="web-$(uuidgen | tr A-Z a-z)"
PW=$(uuidgen | tr A-Z a-z)
echo "SERVERURL $SERVERURL"
echo "UREMOTEID $UREMOTEID"
echo "SRC $SRC"
echo "PW $PW"

ur() { curl -s -X POST "$SERVERURL/client/request" \
    -H "Content-Type: application/json" \
    -H "UR-Connection-ID: $UREMOTEID" -d "$1" | jq -c .; }

# handshake
ur '{"Action":0,"Request":0,"Version":10,"Password":"'$PW'","Platform":"web","Source":"'$SRC'"}'
# capabilities
ur '{"Capabilities":{"Actions":true,"Sync":true,"Grid":true,"Fast":false,"Loading":true,"Encryption2":true},"Action":1,"Request":1,"Source":"'$SRC'"}'

# go to chicago PD
SERIESHOME="https://www.primevideo.com/detail/0M0GF2NPWND7J6HXY5Y09FLA5O"
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":7,"Run":{"Name":"home","Extras":{"Values":[{"Value":"'$SERIESHOME'"}]}},"Source":"'$SRC'"}'

```

# THEN get seasons / resume

```bash
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":9,"Run":{"Name":"episodes"},"Source":"'$SRC'"}'

cat ~/prime-state.json | jq '.seasons[], .resume'

```

# OPEN one of the session

```bash
# go to session home
SESSIONHOME="https://www.primevideo.com/detail/0IWGYTC4I547K7WNXVN7U7HTI4?ref_=atv_dp_season_select_s9"
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":7,"Run":{"Name":"home","Extras":{"Values":[{"Value":"'$SESSIONHOME'"}]}},"Source":"'$SRC'"}'
cat ~/prime-state.json | jq '.episodes[]'

```

# OPEN one of the episodes

```bash
# go to session home
EPISODE="https://www.primevideo.com/detail/0KF777E9GBN6ODMOOD72CJC9GD?autoplay=1&t=0&ref_=atv_dp_btf_el_prime_hd_tv_play_t1ADAAAAAA0wg0"
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":7,"Run":{"Name":"home","Extras":{"Values":[{"Value":"'$EPISODE'"}]}},"Source":"'$SRC'"}'

```

# SEEK +15sec

```bash
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":7,"Run":{"Name":"forward15"},"Source":"'$SRC'"}'

```

# SEEK -15sec

```bash
ur '{"ID":"Arno.PrimeSearch","Action":7,"Request":7,"Run":{"Name":"rewind15"},"Source":"'$SRC'"}'

```
