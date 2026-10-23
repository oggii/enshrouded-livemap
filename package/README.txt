Enshrouded Live Map 1.4.0
=========================

Server-side mod for Enshrouded dedicated servers. The server serves a live web map: players
with names and walking direction, in-game time, weather, the game's map markers, the Flame
Altars you built, and the ore
veins and chests your group finds. Players install nothing; they open a link in the browser.

Works with server builds 25988414 and 26083076 (Enshrouded 1.0, October 2026). On other
builds the mod stays inactive and the server runs as usual; livemap.log says
"unknown server build".

WINDOWS SERVER
1. Stop the server.
2. Copy iphlpapi.dll and the livemap folder next to enshrouded_server.exe.
3. Start the server. The mod writes livemap.ini and livemap.log.
4. Open the game port for TCP too (see PORT).

LINUX / DOCKER (WINE)
1. Stop the container.
2. Copy iphlpapi.dll and the livemap folder next to enshrouded_server.exe.
3. Add iphlpapi=n,b to WINEDLLOVERRIDES
   (with Shared XP: WINEDLLOVERRIDES=powrprof=n,b;iphlpapi=n,b).
4. Publish the game port for TCP too, e.g. 15637:15637/tcp next to 15637:15637/udp.
5. Start the container.

THE LINK
livemap.log shows the link to share: "map link: http://<your ip>:<port>/?key=<key>".
The chat shows it to everyone who joins, in a short form to type.

PORT
The map uses the game's query port number over TCP (the game itself only uses UDP).
Home server: set the router's port forwarding for that port to "TCP and UDP".
Rented server: often open already; otherwise ask for TCP on the game port, or set Port= in
livemap.ini to a TCP port you have.

SETTINGS (livemap.ini, restart the server after changes)
Port=auto              the game's port number over TCP, or a fixed number
PublicUrl=             your own address, e.g. https://map.example.com (empty = public IP)
DetectPublicAddress=1  0 = never ask api.ipify.org for the public IP
AnnounceInChat=1       the map link in the chat when a player joins
Key=<random>           3 to 64 letters, digits, - or _; players can type <address>/<key>
Finds=1                ore veins and looted chests on the map
Bases=1                the players' Flame Altars on the map

Everyone with the link sees all player positions and Flame Altars. Change Key= to lock old
links out.

LOOTED CHESTS
A looted chest counts as full again after 30 minutes (not inside a Flame Altar's build zone).
Other time: add "chestRefillMinutes": 60, at the top of livemap\maps.json (0 = never).

CHECK
livemap.log shows "map link: http://..." and, after a player joins, the chat shows
"Live map: ...". Open the link from outside your network (phone without Wi-Fi).

UNINSTALL
Stop the server and delete iphlpapi.dll, the livemap folder, livemap.ini and livemap.log.

Details and source code: https://github.com/oggii/enshrouded-livemap
