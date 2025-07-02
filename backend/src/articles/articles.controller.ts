import { Controller, Post, Body } from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { Article } from './interfaces/article.interfaces'; // Импортируем интерфейс

class CreateArticleDto {
  title: string;
  content: string;
  author: string;
}

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}
  @Post()
  createArticle(@Body() createArticleDto: CreateArticleDto) {
    console.log('Creating article:', createArticleDto);
    // Здесь можно добавить логику для создания статьи
    // Например, сохранить статью в базе данных или выполнить другие действия

    const newArticle: Article = {
      id: '', // ID будет сгенерирован сервисом
      title: createArticleDto.title,
      content: createArticleDto.content,
      author: createArticleDto.author,
    };

    return this.articlesService.create(newArticle);

    // return {
    //   message: 'Article created successfully',
    //   article: createArticleDto,
    // };
  }
}
