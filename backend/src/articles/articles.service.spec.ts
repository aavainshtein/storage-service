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

  it('should create an article', () => {
    const newArticle: Article = {
      id: '',
      title: 'Test Title',
      content: 'Test Content',
      author: 'Test Author',
    };
    const createdArticle = service.create(newArticle);

    expect(createdArticle).toBeDefined();
    expect(createdArticle.id).toBeDefined();
    expect(createdArticle.title).toEqual('Test Title');
    expect(createdArticle.content).toEqual('Test Content');
  });
});
