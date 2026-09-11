
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = new Map();

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push({r,s});
  for (let i=d.length-1;i>0;i--) {
    const j = crypto.randomInt(i+1);
    [d[i],d[j]]=[d[j],d[i]];
  }
  return d;
}
function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i=0;i<6;i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}
function publicState(room) {
  return {
    roomId: room.id,
    board: room.board,
    street: room.street,
    handNo: room.handNo,
    dealer: room.dealer,
    connected: {
      theodore: !!room.players.theodore,
      ambrose: !!room.players.ambrose
    }
  };
}
function emitState(room) {
  io.to(room.id).emit("publicState", publicState(room));
  for (const role of ["theodore","ambrose"]) {
    const sid = room.players[role];
    if (sid) io.to(sid).emit("privateState", { hand: room.hands[role] || [] });
  }
}
function startHand(room) {
  room.deck = newDeck();
  room.board = [];
  room.street = "preflop";
  room.handNo += 1;
  room.dealer = room.handNo % 2 === 1 ? "theodore" : "ambrose";
  // alternate cards as a real deal would
  room.hands = {theodore: [], ambrose: []};
  room.hands.theodore.push(room.deck.pop());
  room.hands.ambrose.push(room.deck.pop());
  room.hands.theodore.push(room.deck.pop());
  room.hands.ambrose.push(room.deck.pop());
  emitState(room);
}
function burn(room) { room.deck.pop(); }

io.on("connection", socket => {
  socket.on("createRoom", ack => {
    let id;
    do { id = code(); } while (rooms.has(id));
    const room = {
      id, host: socket.id,
      players: {theodore: socket.id, ambrose: null},
      deck: [], hands: {theodore:[],ambrose:[]},
      board: [], street: "waiting", handNo: 0, dealer: "theodore"
    };
    rooms.set(id, room);
    socket.join(id);
    socket.data.roomId = id;
    socket.data.role = "theodore";
    ack({ok:true, roomId:id, role:"theodore"});
    emitState(room);
  });

  socket.on("joinRoom", ({roomId}, ack) => {
    const id = String(roomId || "").toUpperCase();
    const room = rooms.get(id);
    if (!room) return ack({ok:false, error:"房间不存在或已关闭。"});
    if (room.players.ambrose && room.players.ambrose !== socket.id)
      return ack({ok:false, error:"安布罗斯席位已经有人。"});
    room.players.ambrose = socket.id;
    socket.join(id);
    socket.data.roomId = id;
    socket.data.role = "ambrose";
    ack({ok:true, roomId:id, role:"ambrose"});
    emitState(room);
  });

  socket.on("newHand", ack => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.host !== socket.id) return ack?.({ok:false});
    if (!room.players.ambrose) return ack?.({ok:false, error:"等安布罗斯进入房间后再发牌。"});
    startHand(room);
    ack?.({ok:true});
  });

  socket.on("nextStreet", ack => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.host !== socket.id) return ack?.({ok:false});
    if (room.street === "preflop") {
      burn(room); room.board.push(room.deck.pop(),room.deck.pop(),room.deck.pop());
      room.street = "flop";
    } else if (room.street === "flop") {
      burn(room); room.board.push(room.deck.pop()); room.street = "turn";
    } else if (room.street === "turn") {
      burn(room); room.board.push(room.deck.pop()); room.street = "river";
    } else return ack?.({ok:false, error:"这一手已经发完。"});
    emitState(room);
    ack?.({ok:true});
  });

  socket.on("disconnect", () => {
    const id = socket.data.roomId;
    if (!id) return;
    const room = rooms.get(id);
    if (!room) return;
    if (room.host === socket.id) {
      io.to(id).emit("roomClosed");
      rooms.delete(id);
      return;
    }
    if (room.players.ambrose === socket.id) room.players.ambrose = null;
    emitState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Fortuna-7 online on :${PORT}`));
