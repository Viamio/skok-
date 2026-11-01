// Zapis ekip: nazwa + hasło, portfele graczy, ulepszenia postaci, statystyki.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Crews {
  constructor(file) {
    this.file = file;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    this._timer = null;
  }
  _key(name) { return name.trim().toLowerCase(); }
  _hash(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    }, 200);
  }
  // Zwraca { crew } albo { error }
  login(name, pass, create) {
    name = String(name || '').trim().slice(0, 24);
    pass = String(pass || '');
    if (name.length < 2) return { error: 'Nazwa ekipy musi mieć co najmniej 2 znaki.' };
    if (pass.length < 3) return { error: 'Hasło musi mieć co najmniej 3 znaki.' };
    const k = this._key(name);
    const existing = this.data[k];
    if (create) {
      if (existing) return { error: 'Taka ekipa już istnieje. Zaloguj się zamiast zakładać nową.' };
      const salt = crypto.randomBytes(16).toString('hex');
      this.data[k] = {
        name, salt, hash: this._hash(pass, salt), created: Date.now(),
        wallets: {}, inventory: {}, characters: {}, unlocked: ['bank'],
        stats: { heists: 0, success: 0, earned: 0 },
      };
      this.save();
      return { crew: this.data[k] };
    }
    if (!existing) return { error: 'Nie ma takiej ekipy. Sprawdź nazwę albo załóż nową.' };
    if (this._hash(pass, existing.salt) !== existing.hash) return { error: 'Złe hasło ekipy.' };
    return { crew: existing };
  }
  get(name) { return this.data[this._key(name)]; }
  ensureMember(crew, nick) {
    if (!(nick in crew.wallets)) { crew.wallets[nick] = 0; crew.inventory[nick] = []; this.save(); }
  }
  publicView(crew) {
    return {
      name: crew.name, wallets: crew.wallets, characters: crew.characters,
      unlocked: crew.unlocked, stats: crew.stats,
    };
  }
}
