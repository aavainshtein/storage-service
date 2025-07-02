import { Injectable } from '@nestjs/common';
import { Article } from './interfaces/article.interfaces'; // Импортируем интерфейс

@Injectable()
export class ArticlesService {
  private readonly articles: Article[] = []; // Простой массив для хранения статей в памяти

  // Создать новую статью
  create(article: Article): Article {
    article.id = Date.now().toString(); // Генерируем простой ID
    const articleBuffer = { ...article };
    articleBuffer.title = 'Untitled Article'; // Устанавливаем заголовок по умолчанию, если не указан
    this.articles.push(articleBuffer);
    return articleBuffer;
  }
}
