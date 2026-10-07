// Claves compartidas entre catálogos; las etiquetas se muestran siempre en español.
export const discoveryTags = {
  genres: [
    ['action','Acción'],['adventure','Aventura'],['fantasy','Fantasía'],['romance','Romance'],
    ['comedy','Comedia'],['drama','Drama'],['horror','Terror'],['mystery','Misterio'],
    ['thriller','Suspenso'],['psychological','Psicológico'],['sci-fi','Ciencia ficción'],
    ['slice of life','Vida cotidiana'],['sports','Deportes'],['historical','Histórico'],
    ['tragedy','Tragedia'],['crime','Crimen'],['philosophical','Filosófico'],
    ['boys love','Boys Love'],['girls love','Girls Love'],['isekai','Isekai'],
    ['superhero','Superhéroes'],['wuxia','Wuxia'],['adult','+18']
  ],
  themes: [
    ['reincarnation','Reencarnación'],['regression','Regresión'],['revenge','Venganza'],
    ['martial arts','Artes marciales'],['leveling system','Sistema de niveles'],['cultivation','Cultivación'],
    ['dungeons','Mazmorras'],['villainess','Villana'],['magic','Magia'],['supernatural','Sobrenatural'],
    ['school life','Vida escolar'],['survival','Supervivencia'],['monsters','Monstruos'],
    ['superpowers','Superpoderes'],['apocalyptic','Apocalíptico'],['murim','Murim'],
    ['virtual reality','Realidad virtual'],['video games','Videojuegos'],['demons','Demonios'],
    ['vampires','Vampiros'],['zombies','Zombis'],['mecha','Mecha'],['military','Militar'],
    ['time travel','Viajes en el tiempo'],['cooking','Cocina'],['music','Música'],
    ['family','Familia'],['antihero','Antihéroe'],['ninja','Ninjas'],['samurai','Samuráis'],
    ['harem','Harem'],['gore','Gore'],['shounen','Shonen'],['shoujo','Shojo'],
    ['seinen','Seinen'],['josei','Josei']
  ]
};
export const genreKeys = new Set(discoveryTags.genres.map(([key])=>key));
