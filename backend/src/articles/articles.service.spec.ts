// src/articles/articles.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ArticlesService } from './articles.service';
import { Article } from './interfaces/article.interfaces';

describe('ArticlesService', () => {
  let service: ArticlesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ArticlesService],
    }).compile();

    service = module.get<ArticlesService>(ArticlesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- Наш первый тест для TDD (Красный) ---
  it('should create an article', () => {
    const newArticle: Article = {
      id: '', // ID будет сгенерирован сервисом
      title: 'Test Title',
      content: 'Test Content',
      author: 'Test Author',
    };
    const createdArticle = service.create(newArticle);
    console.log('Created Article:', createdArticle); // Выводим созданную статью в консоль
    expect(createdArticle).toBeDefined();
    expect(createdArticle.id).toBeDefined(); // Ожидаем, что ID будет сгенерирован
    expect(createdArticle.title).toEqual('Test Title');
    expect(createdArticle.content).toEqual('Test Content');
  });
  // --- Конец первого теста ---
});
