export interface LibrarySong {
 id:string;title:string;composer:string;illustrator:string;chapter:string;aliases:string[];image:string|null;
}
export interface LibraryChapter {
 id:string;name:string;group:'main'|'side'|'collab'|'other';cover:string;count:number;
}
export interface LibraryCatalog {
 songs:LibrarySong[];chapters:LibraryChapter[];updatedAt:string|null;
}
