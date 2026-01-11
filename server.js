const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 3000 });
console.log("Server running on ws://localhost:3000");

const users = new Map(); // ws -> { username, room, lobby }
const roomSpeaker = new Map(); // room -> username

function findUser(username) {
    for (const [ws, data] of users.entries()) {
        if (data.username === username) return ws;
    }
    return null;
}

function broadcast(room, payload) {
    wss.clients.forEach(client => {
        if (
            client.readyState === WebSocket.OPEN &&
            users.get(client)?.room === room
        ) {
            client.send(JSON.stringify(payload));
        }
    });
}

wss.on("connection", ws => {

    ws.on("message", msg => {
        const data = JSON.parse(msg.toString());

        // JOIN
        if (data.type === "join") {
            users.set(ws, {
                username: data.username,
                room: data.room,
                lobby: data.room
            });
            return;
        }

        const user = users.get(ws);
        if (!user) return;

        // CALL
        if (data.type === "call") {
            const target = findUser(data.to);
            if (!target) return;

            target.send(JSON.stringify({
                type: "incoming-call",
                from: user.username
            }));
            return;
        }

        // ACCEPT CALL
        if (data.type === "accept-call") {
            const target = findUser(data.with);
            if (!target) return;

            const privateRoom = `call-${user.username}-${data.with}`;

            users.get(ws).room = privateRoom;
            users.get(target).room = privateRoom;

            roomSpeaker.set(privateRoom, null);

            ws.send(JSON.stringify({ type: "call-started" }));
            target.send(JSON.stringify({ type: "call-started" }));
            return;
        }

        // END CALL
        if (data.type === "end-call") {
            const room = user.room;

            roomSpeaker.delete(room);

            users.forEach((u, client) => {
                if (u.room === room) {
                    u.room = u.lobby;
                    client.send(JSON.stringify({ type: "call-ended" }));
                }
            });
            return;
        }

        // TALKING (SERVER-LOCKED)
        if (data.type === "talking") {
            const room = user.room;
            const current = roomSpeaker.get(room);

            // Someone else is already talking → reject silently
            if (current && current !== user.username) return;

            roomSpeaker.set(room, user.username);

            broadcast(room, {
                type: "talking",
                user: user.username
            });
            return;
        }

        // STOP TALKING
        if (data.type === "stopped-talking") {
            const room = user.room;

            if (roomSpeaker.get(room) === user.username) {
                roomSpeaker.set(room, null);
                broadcast(room, {
                    type: "stopped-talking"
                });
            }
            return;
        }

        // WEBRTC SIGNALING (ROOM-SCOPED)
        broadcast(user.room, data);
    });

    ws.on("close", () => {
        const user = users.get(ws);
        if (!user) return;

        const room = user.room;

        // Release mic if speaker disconnected
        if (roomSpeaker.get(room) === user.username) {
            roomSpeaker.set(room, null);
            broadcast(room, { type: "stopped-talking" });
        }

        users.delete(ws);
    });
});
